'use strict';

const defaultSellers = [
    { id: '337', name: 'Bruna Giovanini', firstName: 'Bruna', email: 'BrunaGiovanini@essentra.com' },
    { id: '338', name: 'Matheus Silva', firstName: 'Matheus', email: 'MatheusSilva@essentra.com' },
    { id: '340', name: 'Pablo Silva', firstName: 'Pablo', email: 'PabloSilva@essentra.com' },
    { id: '346', name: 'Cristiana Roseto', firstName: 'Cristiana', email: 'CristianaRoseto@essentra.com' },
];

function loadCustomSellers() {
    try {
        const stored = localStorage.getItem('emailleads_custom_sellers');
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

const sellers = [
    ...defaultSellers,
    ...loadCustomSellers().filter(c => !defaultSellers.some(d => d.id === c.id))
];
const copies = ['BrazilWhse@essentra.com', 'EmersonSantos@essentra.com', 'BrazilSamples@essentra.com'];
const stages = ['Envio pendente', 'E-mail enviado', 'Resposta recebida', 'Destino registrado', 'Concluído'];
const maxEmailSize = 20 * 1024 * 1024;
const maxMailtoLength = 2000;
const emailHistories = new WeakMap();
const byId = id => document.getElementById(id);
let database;
let cases = [];
let mainEmail = null;
let selectedId = null;
let completedView = false;
let cancelledView = false;
let busy = false;
let editingRecord = null;

function icons() { if (window.lucide) window.lucide.createIcons(); }
function notify(message, error = false) {
    byId('notice').textContent = message;
    byId('notice').classList.toggle('error', error);
}
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function formatDate(value) { return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
function bodyFor(seller) {
    return `Boa Tarde ${seller.firstName},\r\n\r\nRecebemos o retorno via correio dessa amostra. \r\nFavor informar imediatamente se vai ser reenviado ou deve voltar para o estoque.\r\nCaso reenviado, favor confirmar o endereço e os dados do destinatário/recebedor responsável. \r\n\r\nAguardamos seu retorno.`;
}
function completeBody(seller, originalText = '') {
    return originalText ? `${bodyFor(seller)}\r\n\r\n${originalText.replace(/\r\n?|\n/g, '\r\n')}` : bodyFor(seller);
}
async function extractOriginal(buffer, name) {
    try {
        if (!window.EmailParser) throw new Error('O leitor de e-mails não carregou. Recarregue a página para tentar novamente.');
        return { originalText: await EmailParser.extractHistory(buffer, name), extractionError: '' };
    } catch (error) { return { originalText: '', extractionError: error.message || 'Não foi possível extrair o histórico deste e-mail.' }; }
}
function originalFor(email) {
    if (typeof email.originalText === 'string') return Promise.resolve({ originalText: email.originalText, extractionError: email.extractionError || '' });
    if (!emailHistories.has(email)) emailHistories.set(email, (async () => {
        const response = await fetch(email.data);
        return extractOriginal(await response.arrayBuffer(), email.name);
    })());
    return emailHistories.get(email);
}
function mailtoFor(record, body) {
    const seller = sellers.find(item => item.id === record.sellerId);
    return `mailto:${seller.email}?cc=${encodeURIComponent(copies.join(';'))}&subject=${encodeURIComponent(subjectFor(record))}&body=${encodeURIComponent(body)}`;
}
async function prepareMessage(record) {
    const original = await originalFor(record.mainEmail);
    const seller = sellers.find(item => item.id === record.sellerId);
    const body = completeBody(seller, original.originalText);
    const warning = original.extractionError ? `Histórico não extraído: ${original.extractionError}` :
        mailtoFor(record, body).length > maxMailtoLength ? 'O histórico é longo para o link do Outlook. A mensagem abrirá com o texto padrão; copie a mensagem completa e substitua o corpo antes de enviar.' : '';
    return { body, warning };
}
async function downloadEmail(email) {
    const response = await fetch(email.data);
    download(await response.blob(), email.name);
}
function subjectFor(record) { return `Devolução de amostra - ${record.reference} [${record.code}]`; }
async function openOutlook(record) {
    const seller = sellers.find(item => item.id === record.sellerId);
    const message = await prepareMessage(record);
    if (selectedId === record.id) {
        byId('fullEmailBody').value = message.body;
        byId('outlookWarning').textContent = message.warning;
        byId('copyEmailFeedback').textContent = '';
    }
    const link = document.createElement('a');
    const fullLink = mailtoFor(record, message.body);
    link.href = fullLink.length <= maxMailtoLength ? fullLink : mailtoFor(record, bodyFor(seller));
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('essentra-devolucoes', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('cases', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento local. Verifique as permissões do navegador.'));
        request.onblocked = () => notify('Feche outras abas de devoluções para liberar o armazenamento.', true);
    });
}
function loadCases() {
    return new Promise((resolve, reject) => {
        const request = database.transaction('cases', 'readonly').objectStore('cases').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Não foi possível ler os casos salvos.'));
    });
}
function writeCases(records) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction('cases', 'readwrite');
        const store = transaction.objectStore('cases');
        records.forEach(record => store.put(record));
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(new Error('Não foi possível salvar. O armazenamento pode estar cheio. Faça um backup JSON; nenhum avanço foi confirmado.'));
    });
}
async function refresh() {
    cases = await loadCases();
    render();
}
function render() {
    const activeCases = cases.filter(record => !record.cancelled);
    const counts = stages.map((label, stage) => activeCases.filter(record => record.stage === stage).length);
    byId('metrics').innerHTML = [
        [counts[0] + counts[1], 'Aguardando resposta / envio'], [counts[2], 'Resposta recebida'],
        [counts[3], 'Destino registrado'], [counts[4], 'Concluídos'], [cases.length - activeCases.length, 'Cancelados']
    ].map(([count, label]) => `<div class="metric"><strong>${count}</strong><span>${label}</span></div>`).join('');
    byId('activeCount').textContent = counts.slice(0, 4).reduce((total, count) => total + count, 0);
    byId('completedCount').textContent = counts[4];
    byId('cancelledCount').textContent = cases.length - activeCases.length;
    const query = byId('search').value.trim().toLocaleLowerCase('pt-BR');
    const filter = byId('statusFilter').value;
    const visible = cases.filter(record => {
        const seller = sellers.find(item => item.id === record.sellerId);
        const inView = cancelledView ? Boolean(record.cancelled) : !record.cancelled && (record.stage === 4) === completedView;
        return inView && (filter === '' || (filter === 'cancelled' ? Boolean(record.cancelled) : record.stage === Number(filter))) &&
            `${record.reference} ${record.code} ${seller.name} ${seller.id} ${record.mainEmail.name}`.toLocaleLowerCase('pt-BR').includes(query);
    }).sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
    byId('caseRows').innerHTML = visible.map(record => {
        const seller = sellers.find(item => item.id === record.sellerId);
        const status = record.cancelled ? 'Cancelado' :
            record.stage === 3 ? (record.outcome === 'resent' ? 'Reenviado' : 'Voltou para estoque') : `${record.stage ? `${record.stage} · ` : ''}${stages[record.stage]}`;
        return `<tr><td><small>${escapeHtml(record.code)}</small><button class="case-link" data-case="${escapeHtml(record.id)}"><strong>${escapeHtml(record.reference)}</strong></button><small>${escapeHtml(record.mainEmail.name)}</small></td><td>${escapeHtml(seller.name)}<br><small>${seller.id}</small></td><td><span class="badge ${record.cancelled ? 'cancelled' : `stage-${record.stage}`}">${status}</span></td><td>${formatDate(record.updatedAt)}</td><td><button data-case="${escapeHtml(record.id)}" title="Abrir caso" aria-label="Abrir ${escapeHtml(record.code)}"><i data-lucide="arrow-up-right" aria-hidden="true"></i></button></td></tr>`;
    }).join('');
    byId('empty').hidden = visible.length > 0;
    byId('emptyText').textContent = query || filter ? 'Nenhum caso corresponde aos filtros.' :
        cancelledView ? 'Os casos cancelados ficarão aqui.' : completedView ? 'Os casos concluídos ficarão aqui.' : 'Nenhum caso em andamento.';
    byId('storageStatus').textContent = `${cases.length} caso(s) salvo(s) neste navegador`;
    icons();
}
function updatePreview() {
    const seller = sellers.find(item => item.id === byId('seller').value);
    byId('createBtn').disabled = !mainEmail || !seller || !byId('reference').value.trim() || busy;
    byId('recipients').textContent = seller ? `Para: ${seller.email}\nCc: ${copies.join('; ')}` : '';
    byId('subjectPreview').textContent = seller ? `Assunto: Devolução de amostra - ${byId('reference').value.trim()}` : '';
    byId('bodyPreview').textContent = seller ? completeBody(seller, mainEmail?.originalText) : 'Selecione o vendedor.';
}
async function readEmail(file, includeHistory = false) {
    if (!file || !/\.(msg|eml)$/i.test(file.name)) throw new Error('Insira um e-mail .msg ou .eml. Se o Outlook não entregar o arquivo ao arrastar, salve o e-mail e selecione-o aqui.');
    if (!file.size || file.size > maxEmailSize) throw new Error('O e-mail deve ter conteúdo e no máximo 20 MB.');
    const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o e-mail.'));
        reader.readAsDataURL(file);
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.msg$/i.test(file.name)) {
        const signature = [208, 207, 17, 224, 161, 177, 26, 225];
        if (!signature.every((value, index) => bytes[index] === value)) throw new Error('O arquivo não é um .msg válido do Outlook.');
    } else if (!/^(from|to|subject|date|received|mime-version|return-path|message-id|content-type):/im.test(new TextDecoder().decode(bytes))) {
        throw new Error('O arquivo não contém cabeçalhos de e-mail .eml.');
    }
    const original = includeHistory ? await extractOriginal(bytes.buffer, file.name) : {};
    return { name: file.name, size: file.size, data, addedAt: new Date().toISOString(), ...original };
}
function wireDrop(zoneId, inputId, handler) {
    const zone = byId(zoneId);
    const input = byId(inputId);
    zone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
    });
    zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', event => {
        event.preventDefault(); zone.classList.remove('dragover');
        if (event.dataTransfer.files.length > 1) {
            byId(zoneId === 'mainDrop' ? 'newError' : 'detailError').textContent = 'Insira apenas um e-mail por vez.';
            return;
        }
        handler(event.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { const file = input.files[0]; input.value = ''; if (file) handler(file); });
}
async function attachMain(file) {
    if (busy) return;
    busy = true; updatePreview();
    byId('newError').textContent = '';
    try {
        mainEmail = await readEmail(file, true);
        byId('mainFileName').textContent = `${mainEmail.name} · ${(mainEmail.size / 1024).toFixed(1)} KB`;
        if (mainEmail.extractionError) byId('newError').textContent = `Arquivo selecionado, mas o histórico não foi extraído: ${mainEmail.extractionError}`;
        byId('caseFields').disabled = false;
        if (!byId('reference').value) byId('reference').value = file.name.replace(/\.(msg|eml)$/i, '').slice(0, 180);
    } catch (error) { byId('newError').textContent = error.message; }
    finally { busy = false; updatePreview(); }
}
function renderEmailContent(element, text) {
    const fragment = document.createDocumentFragment();
    const headerPattern = /^(?:\s*>\s*)*\s*(?:From|Sent|To|Cc|Bcc|Subject|Date|De|Para|Assunto|Data|Enviado(?: em)?|Enviada(?: em)?|Com c[oó]pia)\s*:/i;
    text.split(/\r\n?|\n/).forEach((line, index) => {
        if (index) fragment.appendChild(document.createTextNode('\n'));
        if (headerPattern.test(line)) {
            const header = document.createElement('strong');
            header.textContent = line;
            fragment.appendChild(header);
        } else fragment.appendChild(document.createTextNode(line));
    });
    element.replaceChildren(fragment);
}
function showDetail(id) {
    selectedId = id;
    const record = cases.find(item => item.id === id);
    if (!record) return;
    const seller = sellers.find(item => item.id === record.sellerId);
    byId('detailCode').textContent = record.code;
    byId('detailTitle').textContent = record.reference;
    byId('detailSeller').textContent = `${seller.id} · ${seller.name} · ${seller.email}`;
    byId('steps').innerHTML = stages.slice(1).map((label, index) => `<li class="${record.stage > index + 1 ? 'done' : record.stage === index + 1 ? 'current' : ''}">${index + 1}. ${index === 2 ? 'Reenviado / Estoque' : label}</li>`).join('');
    const emails = [['principal', 'E-mail principal', record.mainEmail], ['resposta', 'Resposta do vendedor', record.responseEmail]].filter(item => item[2]);
    byId('attachments').innerHTML = emails.map(([kind, label, email]) => `<div class="email-item"><div class="attachment"><span>${escapeHtml(label)}<small>${escapeHtml(email.name)} · ${(email.size / 1024).toFixed(1)} KB</small></span><button data-download="${kind}" title="Baixar e-mail original" aria-label="Baixar ${escapeHtml(label)}"><i data-lucide="download" aria-hidden="true"></i></button></div><details class="email-content"><summary>Conteúdo do e-mail</summary><pre data-email-content="${kind}" aria-live="polite">Carregando e-mail...</pre></details></div>`).join('');
    emails.forEach(([kind, label, email]) => {
        const content = byId('attachments').querySelector(`[data-email-content="${kind}"]`);
        originalFor(email).then(original => {
            if (!content.isConnected) return;
            renderEmailContent(content, original.originalText || `Conteúdo não disponível: ${original.extractionError || 'Não foi possível ler este e-mail.'} Baixe o original para abrir no Outlook.`);
            content.classList.toggle('error', !original.originalText);
        }).catch(() => {
            if (!content.isConnected) return;
            content.textContent = 'Não foi possível exibir o e-mail. Baixe o original para abrir no Outlook.';
            content.classList.add('error');
        });
    });
    byId('pendingSection').hidden = record.stage !== 0 || Boolean(record.cancelled);
    byId('outlookWarning').textContent = '';
    byId('copyEmailFeedback').textContent = '';
    byId('fullEmailBody').value = '';
    byId('copyEmailBtn').disabled = true;
    byId('messageDetails').open = false;
    if (record.stage === 0 && !record.cancelled) prepareMessage(record).then(message => {
        if (selectedId !== record.id) return;
        byId('fullEmailBody').value = message.body;
        byId('outlookWarning').textContent = message.warning;
        byId('copyEmailBtn').disabled = false;
    }).catch(() => {
        if (selectedId === record.id) byId('outlookWarning').textContent = 'Não foi possível preparar o histórico. Baixe e confira o e-mail original.';
    });
    byId('responseSection').hidden = record.stage !== 1 || Boolean(record.cancelled);
    byId('outcomeSection').hidden = record.stage !== 2 || Boolean(record.cancelled);
    byId('outcomeSummary').hidden = record.stage < 3 || Boolean(record.cancelled);
    byId('caseActions').hidden = Boolean(record.cancelled);
    byId('editBtn').hidden = Boolean(record.cancelled);
    byId('cancelBtn').hidden = Boolean(record.cancelled);
    byId('completeBtn').hidden = record.stage !== 3;
    byId('reactivateBtn').hidden = record.stage !== 4;
    byId('cancelledNotice').hidden = !record.cancelled;
    byId('cancelledNotice').textContent = record.cancelled ?
        `Caso cancelado em ${formatDate(record.cancelledAt)}. Motivo: ${record.cancelReason}` : '';
    byId('outcomeText').textContent = record.outcome === 'resent' ? `Reenviado\nEndereço: ${record.address}\nRecebedor: ${record.recipient}\n${record.notes || ''}` : `Voltou para estoque\n${record.notes || ''}`;
    byId('outcomeForm').reset();
    byId('resendFields').hidden = true;
    byId('address').required = byId('recipient').required = false;
    byId('history').innerHTML = record.history.map(event => `<li>${escapeHtml(event.action)}${event.reason ? `<p class="preserve">Motivo: ${escapeHtml(event.reason)}</p>` : ''}${event.changes?.length ? `<ul>${event.changes.map(change => `<li>${escapeHtml(change.field)}: ${escapeHtml(change.before)} → ${escapeHtml(change.after)}</li>`).join('')}</ul>` : ''}<time>${formatDate(event.at)}</time></li>`).join('');
    byId('detailError').textContent = '';
    icons();
    if (!byId('detailDialog').open) byId('detailDialog').showModal();
}
function assertRecord(record) {
    const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const validEmail = email => email && typeof email.name === 'string' && /\.(msg|eml)$/i.test(email.name) &&
        Number.isInteger(email.size) && email.size > 0 && email.size <= maxEmailSize && validDate(email.addedAt) &&
        typeof email.data === 'string' && /^data:[a-zA-Z0-9.+/;-]*;base64,[A-Za-z0-9+/]+={0,2}$/.test(email.data) &&
        email.data.split(',')[1].length <= Math.ceil(maxEmailSize / 3) * 4 &&
        (email.originalText == null || (typeof email.originalText === 'string' && email.originalText.length <= maxEmailSize * 2)) &&
        (email.extractionError == null || (typeof email.extractionError === 'string' && email.extractionError.length <= 2000));
    if (!record || typeof record.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(record.id) ||
        typeof record.code !== 'string' || record.code.length > 100 ||
        typeof record.reference !== 'string' || !record.reference.trim() || record.reference.length > 180 ||
        !sellers.some(item => item.id === record.sellerId) || !Number.isInteger(record.stage) || record.stage < 0 || record.stage > 4 ||
        !validDate(record.createdAt) || !validDate(record.updatedAt) || !validEmail(record.mainEmail) ||
        (record.responseEmail != null && !validEmail(record.responseEmail)) || (record.stage >= 2 && !validEmail(record.responseEmail)) ||
        (record.stage >= 3 && !['resent', 'stock'].includes(record.outcome)) ||
        (record.stage >= 3 && record.outcome === 'resent' && (typeof record.address !== 'string' || !record.address.trim() || typeof record.recipient !== 'string' || !record.recipient.trim())) ||
        !['address', 'recipient', 'notes'].every(key => record[key] == null || (typeof record[key] === 'string' && record[key].length <= 2000)) ||
        (record.cancelled != null && typeof record.cancelled !== 'boolean') ||
        (record.cancelled && (!validDate(record.cancelledAt) || typeof record.cancelReason !== 'string' || !record.cancelReason.trim() || record.cancelReason.length > 500)) ||
        !Array.isArray(record.history) || !record.history.length || record.history.length > 10000 ||
        !record.history.every(event => event && typeof event.action === 'string' && event.action.length <= 500 && validDate(event.at) &&
            (event.reason == null || (typeof event.reason === 'string' && event.reason.length <= 500)) &&
            (event.changes == null || (Array.isArray(event.changes) && event.changes.length <= 12 &&
                event.changes.every(change => change && typeof change.field === 'string' && change.field.length <= 80 &&
                    typeof change.before === 'string' && change.before.length <= 2000 && typeof change.after === 'string' && change.after.length <= 2000))))) {
        throw new Error('Caso inválido: confira os e-mails obrigatórios, vendedor, destino e histórico do backup.');
    }
}
async function transition(expectedStage, nextStage, action, changes = {}) {
    if (busy) return;
    busy = true;
    try {
        const latest = await loadCases();
        const record = latest.find(item => item.id === selectedId);
        if (!record || record.cancelled || record.stage !== expectedStage) throw new Error('O caso foi alterado ou cancelado em outra aba. Feche e abra novamente antes de continuar.');
        const at = new Date().toISOString();
        const updated = { ...record, ...changes, stage: nextStage, updatedAt: at, history: [...record.history, { action, at }] };
        assertRecord(updated);
        await writeCases([updated]);
        await refresh();
        showDetail(updated.id);
        notify('Caso atualizado e salvo neste navegador.');
    } catch (error) { byId('detailError').textContent = error.message; }
    finally { busy = false; }
}
function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportExcel(records) {
    if (!window.ExcelJS) throw new Error('A biblioteca Excel não carregou. Recarregue a página e tente novamente.');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Essentra - Devoluções';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Devoluções');
    const columns = [
        ['ID', 38], ['Caso', 25], ['Amostra / referência', 40], ['Código do vendedor', 20],
        ['Vendedor', 25], ['E-mail do vendedor', 40], ['Cópias', 75], ['Etapa', 10],
        ['Status', 25], ['Destino', 25], ['Endereço', 50], ['Recebedor', 35], ['Observações', 50],
        ['Criado em (UTC)', 23], ['Atualizado em (UTC)', 23], ['E-mail principal', 40],
        ['Tamanho principal (bytes)', 25], ['Principal inserido em (UTC)', 27], ['E-mail de resposta', 40],
        ['Tamanho resposta (bytes)', 25], ['Resposta inserida em (UTC)', 27], ['Eventos no histórico', 22],
        ['Cancelado', 14], ['Cancelado em (UTC)', 23], ['Motivo do cancelamento', 50]
    ];
    sheet.columns = columns.map(([header, width]) => ({ header, width }));
    const historySheet = workbook.addWorksheet('Histórico');
    historySheet.columns = [['ID do caso', 38], ['Caso', 25], ['Amostra / referência', 40], ['Data (UTC)', 23], ['Evento', 65], ['Motivo', 50], ['Alterações', 100]]
        .map(([header, width]) => ({ header, width }));
    records.forEach(record => {
        const seller = sellers.find(item => item.id === record.sellerId);
        const outcome = record.outcome === 'resent' ? 'Reenviado' : record.outcome === 'stock' ? 'Voltou para estoque' : '';
        sheet.addRow([
            record.id, record.code, record.reference, seller.id, seller.name, seller.email, copies.join('; '),
            record.stage, record.cancelled ? 'Cancelado' : stages[record.stage], outcome, record.address || '', record.recipient || '', record.notes || '',
            new Date(record.createdAt), new Date(record.updatedAt), record.mainEmail.name, record.mainEmail.size,
            new Date(record.mainEmail.addedAt), record.responseEmail?.name || '', record.responseEmail?.size ?? null,
            record.responseEmail ? new Date(record.responseEmail.addedAt) : null, record.history.length,
            Boolean(record.cancelled), record.cancelledAt ? new Date(record.cancelledAt) : null, record.cancelReason || ''
        ]);
        record.history.forEach(event => historySheet.addRow([
            record.id, record.code, record.reference, new Date(event.at), event.action, event.reason || '',
            (event.changes || []).map(change => `${change.field}: ${change.before} → ${change.after}`).join('; ')
        ]));
    });
    [14, 15, 18, 21, 24].forEach(column => { sheet.getColumn(column).numFmt = 'dd/mm/yyyy hh:mm:ss'; });
    historySheet.getColumn(4).numFmt = 'dd/mm/yyyy hh:mm:ss';
    [sheet, historySheet].forEach(worksheet => {
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, worksheet.rowCount), column: worksheet.columnCount } };
        worksheet.getRow(1).height = 32;
        worksheet.getRow(1).eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1763B6' } };
            cell.alignment = { vertical: 'middle', wrapText: true };
        });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `devolucoes-${workbook.created.toISOString().replace(/[:.]/g, '-')}.xlsx`);
}

byId('seller').append(...sellers.map(seller => new Option(`${seller.id} - ${seller.name}`, seller.id)));
byId('editSeller').append(...sellers.map(seller => new Option(`${seller.id} - ${seller.name}`, seller.id)));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { if (!busy) byId(button.dataset.close).close(); }));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }));
byId('newBtn').addEventListener('click', () => {
    if (busy) return;
    byId('newForm').reset(); mainEmail = null;
    byId('caseFields').disabled = true;
    byId('mainFileName').textContent = ''; byId('newError').textContent = '';
    updatePreview(); byId('newDialog').showModal();
});
byId('reference').addEventListener('input', updatePreview);
byId('seller').addEventListener('change', updatePreview);
wireDrop('mainDrop', 'mainFile', attachMain);
wireDrop('responseDrop', 'responseFile', async file => {
    if (busy) return;
    busy = true;
    let responseEmail;
    try { responseEmail = await readEmail(file); }
    catch (error) { byId('detailError').textContent = error.message; }
    finally { busy = false; }
    if (responseEmail) await transition(1, 2, 'Resposta recebida: e-mail do vendedor inserido', { responseEmail });
});
byId('newForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !mainEmail || !byId('seller').value || !byId('reference').value.trim()) return;
    busy = true; updatePreview();
    try {
        const at = new Date().toISOString();
        const id = crypto.randomUUID();
        const record = { id, code: `DEV-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, reference: byId('reference').value.trim(),
            sellerId: byId('seller').value, mainEmail, responseEmail: null, stage: 0, createdAt: at, updatedAt: at,
            outcome: null, address: '', recipient: '', notes: '', history: [{ action: 'Caso criado com e-mail principal; envio pendente', at }] };
        assertRecord(record);
        await writeCases([record]); await refresh();
        byId('newDialog').close(); showDetail(record.id);
        await openOutlook(record);
        notify('Caso salvo. Confirme o envio depois de enviar o e-mail no Outlook.');
    } catch (error) { byId('newError').textContent = error.message; }
    finally { busy = false; updatePreview(); }
});
byId('caseRows').addEventListener('click', event => { const button = event.target.closest('[data-case]'); if (button) showDetail(button.dataset.case); });
byId('editBtn').addEventListener('click', () => {
    const record = cases.find(item => item.id === selectedId);
    if (!record || record.cancelled || busy) return;
    editingRecord = record;
    byId('editForm').reset();
    byId('editReference').value = record.reference;
    byId('editSeller').value = record.sellerId;
    byId('editStage').value = String(record.stage);
    byId('editOutcome').value = record.outcome || '';
    byId('editAddress').value = record.address || '';
    byId('editRecipient').value = record.recipient || '';
    byId('editNotes').value = record.notes || '';
    byId('editMainEmailName').textContent = `Atual: ${record.mainEmail.name}`;
    byId('editResponseEmailName').textContent = record.responseEmail ? `Atual: ${record.responseEmail.name}` : 'Nenhuma resposta anexada.';
    byId('editError').textContent = '';
    byId('editDialog').showModal();
});
byId('editForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !editingRecord) return;
    busy = true;
    try {
        const latest = await loadCases();
        const current = latest.find(item => item.id === editingRecord.id);
        if (!current || current.cancelled || current.updatedAt !== editingRecord.updatedAt) {
            throw new Error('O caso foi alterado ou cancelado em outra aba. Feche e abra novamente antes de editar.');
        }
        const reason = byId('editReason').value.trim();
        if (!reason) throw new Error('Informe o motivo da edição.');
        const mainFile = byId('editMainEmail').files[0];
        const responseFile = byId('editResponseEmail').files[0];
        if (responseFile && byId('removeResponseEmail').checked) {
            throw new Error('Escolha substituir ou remover o e-mail de resposta, não as duas opções.');
        }
        const updated = {
            ...current,
            reference: byId('editReference').value.trim(),
            sellerId: byId('editSeller').value,
            stage: Number(byId('editStage').value),
            outcome: byId('editOutcome').value || null,
            address: byId('editAddress').value.trim(),
            recipient: byId('editRecipient').value.trim(),
            notes: byId('editNotes').value.trim()
        };
        if (mainFile) updated.mainEmail = await readEmail(mainFile, true);
        if (responseFile) updated.responseEmail = await readEmail(responseFile, true);
        else if (byId('removeResponseEmail').checked) updated.responseEmail = null;

        const displayStage = value => `${value} · ${stages[value]}`;
        const displayOutcome = value => value === 'resent' ? 'Reenviado' : value === 'stock' ? 'Voltou para estoque' : 'Não informado';
        const fieldChanges = [
            ['Referência', current.reference, updated.reference],
            ['Vendedor', sellers.find(item => item.id === current.sellerId).name, sellers.find(item => item.id === updated.sellerId)?.name || updated.sellerId],
            ['Etapa', displayStage(current.stage), displayStage(updated.stage)],
            ['Destino', displayOutcome(current.outcome), displayOutcome(updated.outcome)],
            ['Endereço', current.address || '', updated.address],
            ['Recebedor', current.recipient || '', updated.recipient],
            ['Observações', current.notes || '', updated.notes]
        ].filter(([, before, after]) => before !== after)
            .map(([field, before, after]) => ({ field, before: String(before), after: String(after) }));
        const emailDescription = email => email ? `${email.name} (${email.size} bytes)` : 'Não informado';
        if (current.mainEmail.data !== updated.mainEmail.data || current.mainEmail.name !== updated.mainEmail.name) {
            fieldChanges.push({ field: 'E-mail principal', before: emailDescription(current.mainEmail), after: `${emailDescription(updated.mainEmail)} (substituído)` });
        }
        const responseChanged = current.responseEmail?.data !== updated.responseEmail?.data ||
            current.responseEmail?.name !== updated.responseEmail?.name;
        if (responseChanged) {
            fieldChanges.push({
                field: 'E-mail de resposta', before: emailDescription(current.responseEmail),
                after: updated.responseEmail ? `${emailDescription(updated.responseEmail)} (substituído)` : 'Removido'
            });
        }
        if (!fieldChanges.length) throw new Error('Nenhuma alteração foi feita.');
        const at = new Date().toISOString();
        updated.updatedAt = at;
        updated.history = [...current.history, { action: 'Caso editado', at, reason, changes: fieldChanges }];
        const latestBeforeWrite = await loadCases();
        const latestRecord = latestBeforeWrite.find(item => item.id === current.id);
        if (!latestRecord || latestRecord.cancelled || latestRecord.updatedAt !== current.updatedAt) {
            throw new Error('O caso foi alterado ou cancelado em outra aba durante a edição. Feche e abra novamente.');
        }
        assertRecord(updated);
        await writeCases([updated]);
        editingRecord = null;
        byId('editDialog').close();
        await refresh();
        showDetail(updated.id);
        notify('Edição salva e registrada no histórico.');
    } catch (error) { byId('editError').textContent = error.message; }
    finally { busy = false; }
});
byId('cancelBtn').addEventListener('click', () => {
    const record = cases.find(item => item.id === selectedId);
    if (!record || record.cancelled || busy) return;
    byId('cancelForm').reset();
    byId('cancelError').textContent = '';
    byId('cancelDialog').showModal();
});
byId('cancelForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
        const reason = byId('cancelReason').value.trim();
        if (!reason) throw new Error('Informe o motivo do cancelamento.');
        const latest = await loadCases();
        const current = latest.find(item => item.id === selectedId);
        const displayed = cases.find(item => item.id === selectedId);
        if (!current || current.cancelled || !displayed || current.updatedAt !== displayed.updatedAt) {
            throw new Error('O caso foi alterado ou cancelado em outra aba. Feche e abra novamente antes de continuar.');
        }
        const at = new Date().toISOString();
        const updated = {
            ...current, cancelled: true, cancelledAt: at, cancelReason: reason, updatedAt: at,
            history: [...current.history, { action: 'Caso cancelado', at, reason }]
        };
        assertRecord(updated);
        await writeCases([updated]);
        byId('cancelDialog').close();
        await refresh();
        showDetail(updated.id);
        notify('Caso cancelado. Os dados e todo o histórico foram preservados.');
    } catch (error) { byId('cancelError').textContent = error.message; }
    finally { busy = false; }
});
byId('attachments').addEventListener('click', async event => {
    const button = event.target.closest('[data-download]');
    if (!button) return;
    try {
        const record = cases.find(item => item.id === selectedId);
        const email = button.dataset.download === 'principal' ? record.mainEmail : record.responseEmail;
        await downloadEmail(email);
    } catch { byId('detailError').textContent = 'Não foi possível baixar o e-mail.'; }
});
byId('outlookBtn').addEventListener('click', () => {
    openOutlook(cases.find(item => item.id === selectedId)).catch(() => {
        byId('detailError').textContent = 'Não foi possível abrir a mensagem. Baixe e confira o e-mail original.';
    });
});
byId('copyEmailBtn').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(byId('fullEmailBody').value);
        byId('copyEmailFeedback').textContent = 'Texto exibido copiado. Cole no corpo do e-mail no Outlook antes de enviar.';
    } catch {
        byId('messageDetails').open = true;
        byId('fullEmailBody').focus(); byId('fullEmailBody').select();
        byId('copyEmailFeedback').textContent = 'O navegador bloqueou a cópia automática. O texto completo está selecionado para copiar manualmente.';
    }
});
byId('sentBtn').addEventListener('click', () => transition(0, 1, 'Envio do e-mail confirmado pelo usuário'));
byId('outcomeForm').addEventListener('change', () => {
    const resend = new FormData(byId('outcomeForm')).get('outcome') === 'resent';
    byId('resendFields').hidden = !resend;
    byId('address').required = byId('recipient').required = resend;
});
byId('outcomeForm').addEventListener('submit', event => {
    event.preventDefault();
    const outcome = new FormData(event.target).get('outcome');
    const address = byId('address').value.trim(); const recipient = byId('recipient').value.trim();
    if (!['resent', 'stock'].includes(outcome) || (outcome === 'resent' && (!address || !recipient))) {
        byId('detailError').textContent = 'Informe o destino e, para reenvio, o endereço e o recebedor.'; return;
    }
    transition(2, 3, outcome === 'resent' ? 'Amostra reenviada' : 'Amostra voltou para estoque', { outcome, address: outcome === 'resent' ? address : '', recipient: outcome === 'resent' ? recipient : '', notes: byId('outcomeNotes').value.trim() });
});
byId('completeBtn').addEventListener('click', () => transition(3, 4, 'Caso concluído'));
byId('reactivateBtn').addEventListener('click', () => transition(4, 2, 'Caso reativado para revisão do destino', { outcome: null, address: '', recipient: '', notes: '' }));
function setView(completed, cancelled = false) {
    completedView = completed; cancelledView = cancelled; byId('statusFilter').value = '';
    byId('activeTab').classList.toggle('selected', !completed && !cancelled);
    byId('completedTab').classList.toggle('selected', completed && !cancelled);
    byId('cancelledTab').classList.toggle('selected', cancelled);
    byId('activeTab').setAttribute('aria-pressed', String(!completed && !cancelled));
    byId('completedTab').setAttribute('aria-pressed', String(completed && !cancelled));
    byId('cancelledTab').setAttribute('aria-pressed', String(cancelled));
    render();
}
byId('activeTab').addEventListener('click', () => setView(false));
byId('completedTab').addEventListener('click', () => setView(true));
byId('cancelledTab').addEventListener('click', () => setView(false, true));
byId('search').addEventListener('input', render);
byId('statusFilter').addEventListener('change', render);
byId('excelBtn').addEventListener('click', async () => {
    if (!database || busy) return;
    busy = true;
    byId('excelBtn').disabled = true;
    notify('Preparando planilha Excel...');
    try {
        const records = await loadCases();
        await exportExcel(records.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)));
        notify(`Excel gerado com ${records.length} caso(s), incluindo concluídos, e histórico completo.`);
    } catch (error) { notify(`Excel não gerado: ${error.message}`, true); }
    finally { busy = false; byId('excelBtn').disabled = false; }
});
byId('exportBtn').addEventListener('click', async () => {
    if (!database || busy) return;
    try {
        const records = await loadCases();
        const exportedAt = new Date().toISOString();
        download(new Blob([JSON.stringify({ app: 'essentra-devolucoes', version: 1, exportedAt, cases: records }, null, 2)], { type: 'application/json' }), `devolucoes-${exportedAt.replace(/[:.]/g, '-')}.json`);
        byId('backupStatus').textContent = `Backup JSON gerado: ${formatDate(exportedAt)}`;
        notify('Backup JSON gerado com todos os casos e e-mails originais.');
    } catch (error) { notify(error.message, true); }
});
byId('importBtn').addEventListener('click', () => { if (database && !busy) byId('importFile').click(); });
byId('importFile').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || busy) return;
    busy = true;
    try {
        if (file.size > 200 * 1024 * 1024) throw new Error('O backup excede o limite de importação de 200 MB.');
        const backup = JSON.parse(await file.text());
        if (!backup || backup.app !== 'essentra-devolucoes' || backup.version !== 1 || !Array.isArray(backup.cases)) throw new Error('Selecione um backup JSON deste aplicativo (versão 1).');
        backup.cases.forEach(assertRecord);
        if (new Set(backup.cases.map(record => record.id)).size !== backup.cases.length) throw new Error('O backup contém casos duplicados.');
        const current = await loadCases();
        const overlapping = backup.cases.filter(record => current.some(item => item.id === record.id)).length;
        const locallyCancelled = new Map(current.filter(record => record.cancelled).map(record => [record.id, record]));
        const preservedCancelled = backup.cases.filter(record => locallyCancelled.has(record.id)).length;
        if (!window.confirm(`Restaurar ${backup.cases.length} caso(s)? ${overlapping} caso(s) com o mesmo ID serão substituídos pelo backup, exceto ${preservedCancelled} caso(s) já cancelado(s) neste navegador. Os demais casos atuais serão preservados.`)) return;
        const restored = backup.cases.map(record => locallyCancelled.get(record.id) || record);
        await writeCases(restored); await refresh();
        if (byId('detailDialog').open) showDetail(selectedId);
        notify(`${backup.cases.length} caso(s) restaurado(s), incluindo os e-mails.${preservedCancelled ? ` ${preservedCancelled} caso(s) cancelado(s) localmente permaneceram cancelados.` : ''}`);
    } catch (error) { notify(`Backup não importado: ${error.message}`, true); }
    finally { busy = false; }
});
window.addEventListener('focus', () => { if (database && !busy && !byId('detailDialog').open) refresh().catch(error => notify(error.message, true)); });
async function initialize() {
    try {
        database = await openDatabase(); await refresh();
        byId('newBtn').disabled = false;
        byId('excelBtn').disabled = false;
        notify('');
    } catch (error) { notify(error.message, true); byId('storageStatus').textContent = 'Armazenamento indisponível'; }
    icons();
}
initialize();
