'use strict';

const sellers = [
    { id: '338', name: 'Matheus Silva', firstName: 'Matheus', email: 'MatheusSilva@essentra.com' },
    { id: '340', name: 'Pablo Silva', firstName: 'Pablo', email: 'PabloSilva@essentra.com' },
    { id: '346', name: 'Cristiana Roseto', firstName: 'Cristiana', email: 'CristianaRoseto@essentra.com' }
];
const copies = ['BrazilWhse@essentra.com', 'EmersonSantos@essentra.com', 'BrazilSamples@essentra.com'];
const stages = ['Envio pendente', 'E-mail enviado', 'Resposta recebida', 'Destino registrado', 'Concluído'];
const maxEmailSize = 20 * 1024 * 1024;
const byId = id => document.getElementById(id);
let database;
let cases = [];
let mainEmail = null;
let selectedId = null;
let completedView = false;
let busy = false;

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
async function downloadEmail(email) {
    const response = await fetch(email.data);
    download(await response.blob(), email.name);
}
async function prepareForward(record) {
    try {
        await downloadEmail(record.mainEmail);
        notify('Original baixado. Abra o arquivo no Outlook, use Encaminhar e confirme o envio no caso.');
    } catch {
        byId('detailError').textContent = 'Caso salvo, mas não foi possível baixar o original. Tente novamente pelo botão de download.';
    }
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
    const counts = stages.map((label, stage) => cases.filter(record => record.stage === stage).length);
    byId('metrics').innerHTML = [
        [counts[0] + counts[1], 'Aguardando resposta / envio'], [counts[2], 'Resposta recebida'],
        [counts[3], 'Destino registrado'], [counts[4], 'Concluídos']
    ].map(([count, label]) => `<div class="metric"><strong>${count}</strong><span>${label}</span></div>`).join('');
    byId('activeCount').textContent = cases.length - counts[4];
    byId('completedCount').textContent = counts[4];
    const query = byId('search').value.trim().toLocaleLowerCase('pt-BR');
    const filter = byId('statusFilter').value;
    const visible = cases.filter(record => {
        const seller = sellers.find(item => item.id === record.sellerId);
        return (record.stage === 4) === completedView && (filter === '' || record.stage === Number(filter)) &&
            `${record.reference} ${record.code} ${seller.name} ${seller.id} ${record.mainEmail.name}`.toLocaleLowerCase('pt-BR').includes(query);
    }).sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
    byId('caseRows').innerHTML = visible.map(record => {
        const seller = sellers.find(item => item.id === record.sellerId);
        return `<tr><td><small>${escapeHtml(record.code)}</small><button class="case-link" data-case="${escapeHtml(record.id)}"><strong>${escapeHtml(record.reference)}</strong></button><small>${escapeHtml(record.mainEmail.name)}</small></td><td>${escapeHtml(seller.name)}<br><small>${seller.id}</small></td><td><span class="badge stage-${record.stage}">${record.stage ? `${record.stage} · ` : ''}${record.stage === 3 ? (record.outcome === 'resent' ? 'Reenviado' : 'Voltou para estoque') : stages[record.stage]}</span></td><td>${formatDate(record.updatedAt)}</td><td><button data-case="${escapeHtml(record.id)}" title="Abrir caso" aria-label="Abrir ${escapeHtml(record.code)}"><i data-lucide="arrow-up-right" aria-hidden="true"></i></button></td></tr>`;
    }).join('');
    byId('empty').hidden = visible.length > 0;
    byId('emptyText').textContent = query || filter ? 'Nenhum caso corresponde aos filtros.' : (completedView ? 'Os casos concluídos ficarão aqui.' : 'Nenhum caso em andamento.');
    byId('storageStatus').textContent = `${cases.length} caso(s) salvo(s) neste navegador`;
    icons();
}
function updatePreview() {
    const seller = sellers.find(item => item.id === byId('seller').value);
    byId('createBtn').disabled = !mainEmail || !seller || !byId('reference').value.trim() || busy;
    byId('recipients').textContent = seller ? `Para: ${seller.email}\nCc: ${copies.join('; ')}` : '';
    byId('bodyPreview').textContent = seller ? bodyFor(seller) : 'Selecione o vendedor.';
}
async function readEmail(file) {
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
    return { name: file.name, size: file.size, data, addedAt: new Date().toISOString() };
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
        mainEmail = await readEmail(file);
        byId('mainFileName').textContent = `${mainEmail.name} · ${(mainEmail.size / 1024).toFixed(1)} KB`;
        byId('caseFields').disabled = false;
        if (!byId('reference').value) byId('reference').value = file.name.replace(/\.(msg|eml)$/i, '').slice(0, 180);
    } catch (error) { byId('newError').textContent = error.message; }
    finally { busy = false; updatePreview(); }
}
function showDetail(id) {
    selectedId = id;
    const record = cases.find(item => item.id === id);
    if (!record) return;
    const seller = sellers.find(item => item.id === record.sellerId);
    byId('detailCode').textContent = record.code;
    byId('detailTitle').textContent = record.reference;
    byId('detailSeller').textContent = `${seller.id} · ${seller.name} · ${seller.email}`;
    byId('forwardTo').textContent = `Para: ${seller.email}`;
    byId('forwardCc').textContent = `Cc: ${copies.join('; ')}`;
    byId('forwardBody').textContent = bodyFor(seller);
    byId('steps').innerHTML = stages.slice(1).map((label, index) => `<li class="${record.stage > index + 1 ? 'done' : record.stage === index + 1 ? 'current' : ''}">${index + 1}. ${index === 2 ? 'Reenviado / Estoque' : label}</li>`).join('');
    const emails = [['principal', 'E-mail principal', record.mainEmail], ['resposta', 'Resposta do vendedor', record.responseEmail]].filter(item => item[2]);
    byId('attachments').innerHTML = emails.map(([kind, label, email]) => `<div class="attachment"><span>${escapeHtml(label)}<small>${escapeHtml(email.name)} · ${(email.size / 1024).toFixed(1)} KB</small></span><button data-download="${kind}" title="Baixar e-mail original" aria-label="Baixar ${escapeHtml(label)}"><i data-lucide="download" aria-hidden="true"></i></button></div>`).join('');
    byId('pendingSection').hidden = record.stage !== 0;
    byId('responseSection').hidden = record.stage !== 1;
    byId('outcomeSection').hidden = record.stage !== 2;
    byId('outcomeSummary').hidden = record.stage < 3;
    byId('completeBtn').hidden = record.stage !== 3;
    byId('reactivateBtn').hidden = record.stage !== 4;
    byId('outcomeText').textContent = record.outcome === 'resent' ? `Reenviado\nEndereço: ${record.address}\nRecebedor: ${record.recipient}\n${record.notes || ''}` : `Voltou para estoque\n${record.notes || ''}`;
    byId('outcomeForm').reset();
    byId('resendFields').hidden = true;
    byId('address').required = byId('recipient').required = false;
    byId('history').innerHTML = record.history.map(event => `<li>${escapeHtml(event.action)}<time>${formatDate(event.at)}</time></li>`).join('');
    byId('detailError').textContent = '';
    icons();
    if (!byId('detailDialog').open) byId('detailDialog').showModal();
}
function assertRecord(record) {
    const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const validEmail = email => email && typeof email.name === 'string' && /\.(msg|eml)$/i.test(email.name) &&
        Number.isInteger(email.size) && email.size > 0 && email.size <= maxEmailSize && validDate(email.addedAt) &&
        typeof email.data === 'string' && /^data:[a-zA-Z0-9.+/;-]*;base64,[A-Za-z0-9+/]+={0,2}$/.test(email.data) &&
        email.data.split(',')[1].length <= Math.ceil(maxEmailSize / 3) * 4;
    if (!record || typeof record.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(record.id) ||
        typeof record.code !== 'string' || record.code.length > 100 ||
        typeof record.reference !== 'string' || !record.reference.trim() || record.reference.length > 180 ||
        !sellers.some(item => item.id === record.sellerId) || !Number.isInteger(record.stage) || record.stage < 0 || record.stage > 4 ||
        !validDate(record.createdAt) || !validDate(record.updatedAt) || !validEmail(record.mainEmail) ||
        (record.responseEmail != null && !validEmail(record.responseEmail)) || (record.stage >= 2 && !validEmail(record.responseEmail)) ||
        (record.stage >= 3 && !['resent', 'stock'].includes(record.outcome)) ||
        (record.stage >= 3 && record.outcome === 'resent' && (typeof record.address !== 'string' || !record.address.trim() || typeof record.recipient !== 'string' || !record.recipient.trim())) ||
        !['address', 'recipient', 'notes'].every(key => record[key] == null || (typeof record[key] === 'string' && record[key].length <= 2000)) ||
        !Array.isArray(record.history) || !record.history.length || record.history.length > 10000 ||
        !record.history.every(event => event && typeof event.action === 'string' && event.action.length <= 500 && validDate(event.at))) {
        throw new Error('Caso inválido: confira os e-mails obrigatórios, vendedor, destino e histórico do backup.');
    }
}
async function transition(expectedStage, nextStage, action, changes = {}) {
    if (busy) return;
    busy = true;
    try {
        const latest = await loadCases();
        const record = latest.find(item => item.id === selectedId);
        if (!record || record.stage !== expectedStage) throw new Error('O caso foi alterado em outra aba. Feche e abra novamente antes de continuar.');
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
        ['Tamanho resposta (bytes)', 25], ['Resposta inserida em (UTC)', 27], ['Eventos no histórico', 22]
    ];
    sheet.columns = columns.map(([header, width]) => ({ header, width }));
    const historySheet = workbook.addWorksheet('Histórico');
    historySheet.columns = [['ID do caso', 38], ['Caso', 25], ['Amostra / referência', 40], ['Data (UTC)', 23], ['Evento', 65]]
        .map(([header, width]) => ({ header, width }));
    records.forEach(record => {
        const seller = sellers.find(item => item.id === record.sellerId);
        const outcome = record.outcome === 'resent' ? 'Reenviado' : record.outcome === 'stock' ? 'Voltou para estoque' : '';
        sheet.addRow([
            record.id, record.code, record.reference, seller.id, seller.name, seller.email, copies.join('; '),
            record.stage, stages[record.stage], outcome, record.address || '', record.recipient || '', record.notes || '',
            new Date(record.createdAt), new Date(record.updatedAt), record.mainEmail.name, record.mainEmail.size,
            new Date(record.mainEmail.addedAt), record.responseEmail?.name || '', record.responseEmail?.size ?? null,
            record.responseEmail ? new Date(record.responseEmail.addedAt) : null, record.history.length
        ]);
        record.history.forEach(event => historySheet.addRow([record.id, record.code, record.reference, new Date(event.at), event.action]));
    });
    [14, 15, 18, 21].forEach(column => { sheet.getColumn(column).numFmt = 'dd/mm/yyyy hh:mm:ss'; });
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
        await prepareForward(record);
    } catch (error) { byId('newError').textContent = error.message; }
    finally { busy = false; updatePreview(); }
});
byId('caseRows').addEventListener('click', event => { const button = event.target.closest('[data-case]'); if (button) showDetail(button.dataset.case); });
byId('attachments').addEventListener('click', async event => {
    const button = event.target.closest('[data-download]');
    if (!button) return;
    try {
        const record = cases.find(item => item.id === selectedId);
        const email = button.dataset.download === 'principal' ? record.mainEmail : record.responseEmail;
        await downloadEmail(email);
    } catch { byId('detailError').textContent = 'Não foi possível baixar o e-mail.'; }
});
byId('forwardBtn').addEventListener('click', () => prepareForward(cases.find(item => item.id === selectedId)));
document.querySelectorAll('[data-copy-forward]').forEach(button => button.addEventListener('click', async () => {
    const record = cases.find(item => item.id === selectedId);
    const seller = sellers.find(item => item.id === record.sellerId);
    const values = { to: seller.email, cc: copies.join('; '), body: bodyFor(seller) };
    try {
        await navigator.clipboard.writeText(values[button.dataset.copyForward]);
        byId('detailError').textContent = '';
        notify('Copiado para a área de transferência.');
    } catch { byId('detailError').textContent = 'O navegador bloqueou a cópia. Selecione e copie o texto exibido acima.'; }
}));
byId('sentBtn').addEventListener('click', () => transition(0, 1, 'Encaminhamento do e-mail confirmado pelo usuário'));
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
function setView(completed) {
    completedView = completed; byId('statusFilter').value = '';
    byId('activeTab').classList.toggle('selected', !completed);
    byId('completedTab').classList.toggle('selected', completed);
    byId('activeTab').setAttribute('aria-pressed', String(!completed));
    byId('completedTab').setAttribute('aria-pressed', String(completed)); render();
}
byId('activeTab').addEventListener('click', () => setView(false));
byId('completedTab').addEventListener('click', () => setView(true));
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
        if (!window.confirm(`Restaurar ${backup.cases.length} caso(s)? ${overlapping} caso(s) com o mesmo ID serão substituídos pelo backup. Os demais casos atuais serão preservados.`)) return;
        await writeCases(backup.cases); await refresh();
        if (byId('detailDialog').open) showDetail(selectedId);
        notify(`${backup.cases.length} caso(s) restaurado(s), incluindo os e-mails.`);
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