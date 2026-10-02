const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

const root = path.resolve(__dirname, '..');
const server = http.createServer(async (request, response) => {
    try {
        let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname === '/devolucoes') {
            response.writeHead(301, { Location: '/devolucoes/' }); response.end(); return;
        }
        if (pathname.endsWith('/')) pathname += 'index.html';
        const filename = path.resolve(root, `.${pathname}`);
        if (!filename.startsWith(`${root}/`)) { response.writeHead(403); response.end(); return; }
        const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[path.extname(filename)];
        response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' });
        response.end(await fs.readFile(filename));
    } catch { response.writeHead(404); response.end(); }
});

async function run() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/devolucoes`;
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => !document.getElementById('newBtn').disabled);
        assert(page.url().endsWith('/devolucoes/'));
        assert.equal(await page.locator('.topbar a[href="../enviodeemails.html"]').count(), 0);
        async function readExcel(current) {
            const downloading = current.waitForEvent('download');
            await current.locator('#excelBtn').click();
            const exported = await downloading;
            assert(exported.suggestedFilename().endsWith('.xlsx'));
            const buffer = await fs.readFile(await exported.path());
            assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304');
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            return workbook;
        }
        const emptyWorkbook = await readExcel(page);
        assert.deepEqual(emptyWorkbook.worksheets.map(sheet => sheet.name), ['Devoluções', 'Histórico']);
        assert.equal(emptyWorkbook.getWorksheet('Devoluções').rowCount, 1);
        assert.equal(emptyWorkbook.getWorksheet('Histórico').rowCount, 1);
        await page.evaluate(() => {
            window.sentLinks = [];
            window.emailDownloads = [];
            window.copiedBodies = [];
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => window.copiedBodies.push(value) } });
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                if (this.href.startsWith('mailto:')) { window.sentLinks.push(this.href); return; }
                if (/\.(msg|eml)$/i.test(this.download)) window.emailDownloads.push(this.download);
                original.call(this);
            };
        });
        const email = { name: 'Amostra original.eml', mimeType: 'message/rfc822', buffer: Buffer.from('From: cliente@example.com\r\nTo: BrazilSamples@essentra.com\r\nSubject: Amostra original\r\n\r\nAmostra retornada pelo correio.') };
        const reply = { name: 'Resposta.eml', mimeType: 'message/rfc822', buffer: Buffer.from('From: CristianaRoseto@essentra.com\r\nSubject: RE: Amostra original\r\n\r\nReenviar para o cliente.') };
        await page.locator('#newBtn').click();
        assert(await page.locator('#seller').isDisabled());
        assert(await page.locator('#createBtn').isDisabled());
        await page.locator('#mainFile').setInputFiles({ name: 'falso.msg', mimeType: 'application/octet-stream', buffer: Buffer.from('arquivo inválido') });
        await page.locator('#newError').filter({ hasText: 'não é um .msg válido' }).waitFor();
        assert(await page.locator('#seller').isDisabled());
        await page.locator('#mainFile').setInputFiles(email);
        await page.waitForFunction(() => !document.getElementById('seller').disabled);
        assert.deepEqual(await page.locator('#seller option').allTextContents(), ['Selecione o vendedor', '338 - Matheus Silva', '340 - Pablo Silva', '346 - Cristiana Roseto']);
        await page.locator('#seller').selectOption('346');
        await page.locator('#reference').fill('Amostra <script>segura</script>');
        await page.locator('#createBtn').click();
        await page.locator('#detailDialog').waitFor({ state: 'visible' });
        await page.waitForFunction(() => window.sentLinks.length === 1);
        const mailto = new URL(await page.evaluate(() => window.sentLinks[0]));
        assert.equal(mailto.pathname, 'CristianaRoseto@essentra.com');
        assert.equal(mailto.searchParams.get('cc'), 'BrazilWhse@essentra.com;EmersonSantos@essentra.com;BrazilSamples@essentra.com');
        assert.equal(mailto.searchParams.get('subject'), `Devolução de amostra - Amostra <script>segura</script> [${await page.locator('#detailCode').textContent()}]`);
        assert.equal(mailto.searchParams.get('body'), 'Boa Tarde Cristiana,\r\n\r\nRecebemos o retorno via correio dessa amostra. \r\nFavor informar imediatamente se vai ser reenviado ou deve voltar para o estoque.\r\nCaso reenviado, favor confirmar o endereço e os dados do destinatário/recebedor responsável. \r\n\r\nAguardamos seu retorno.\r\n\r\n----- E-mail original -----\r\nDe: cliente@example.com\r\nPara: BrazilSamples@essentra.com\r\nAssunto: Amostra original\r\n\r\nAmostra retornada pelo correio.');
        assert.deepEqual(await page.evaluate(() => window.emailDownloads), []);
        await page.locator('#outlookBtn').click();
        await page.waitForFunction(() => window.sentLinks.length === 2);
        assert.equal(await page.evaluate(() => window.sentLinks[1]), mailto.href);
        const msgBytes = [...await fs.readFile(path.join(__dirname, 'historico.msg'))];
        const parsedMsg = await page.evaluate(async bytes => EmailParser.extractHistory(new Uint8Array(bytes).buffer, 'historico.msg'), msgBytes);
        assert.match(parsedMsg, /Assunto: title/);
        assert.match(parsedMsg, /Para: to@example.com/);
        assert.match(parsedMsg, /Cc: cc@example.com/);
        assert(parsedMsg.endsWith('body'));
        const parsedHtml = await page.evaluate(async () => {
            const source = 'From: =?UTF-8?B?Sm9zw6k=?= <jose@example.com>\r\nTo: cliente@example.com\r\nSubject: =?UTF-8?B?RGV2b2x1w6fDo28=?=\r\nDate: Fri, 2 Oct 2026 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + btoa(unescape(encodeURIComponent('<p>Ação recebida.</p><blockquote><p>Histórico anterior completo.</p></blockquote><img src="invalid" onerror="window.unsafeEmail = true"><script>window.unsafeEmail = true</script>')));
            return EmailParser.extractHistory(new TextEncoder().encode(source).buffer, 'html.eml');
        });
        assert.match(parsedHtml, /De: José <jose@example.com>/);
        assert.match(parsedHtml, /Assunto: Devolução/);
        assert.match(parsedHtml, /Ação recebida/);
        assert.match(parsedHtml, /Histórico anterior completo/);
        assert(!parsedHtml.includes('window.unsafeEmail'));
        assert.equal(await page.evaluate(() => window.unsafeEmail), undefined);
        const legacyHistory = await page.evaluate(async () => {
            const original = { ...cases[0].mainEmail };
            delete original.originalText; delete original.extractionError;
            return prepareMessage({ ...cases[0], mainEmail: original });
        });
        assert.equal(legacyHistory.body, mailto.searchParams.get('body'));
        const longMessage = await page.evaluate(async () => {
            const record = { ...cases[0], mainEmail: { ...cases[0].mainEmail, originalText: 'INÍCIO DO HISTÓRICO\n' + 'Conteúdo anterior.\n'.repeat(1000) + 'FIM DO HISTÓRICO' } };
            await openOutlook(record);
            return { text: document.getElementById('fullEmailBody').value, warning: document.getElementById('outlookWarning').textContent, link: window.sentLinks.at(-1) };
        });
        assert.match(longMessage.warning, /histórico é longo/);
        assert(longMessage.text.endsWith('FIM DO HISTÓRICO'));
        assert(longMessage.text.includes('INÍCIO DO HISTÓRICO'));
        assert(longMessage.link.length <= 2000);
        assert(!new URL(longMessage.link).searchParams.get('body').includes('INÍCIO DO HISTÓRICO'));
        await page.locator('#copyEmailBtn').click();
        assert.equal(await page.evaluate(() => window.copiedBodies.at(-1)), longMessage.text);
        assert.match(await page.locator('#outlookWarning').textContent(), /histórico é longo/);
        await page.evaluate(() => {
            navigator.clipboard.writeText = async () => { throw new Error('Cópia bloqueada'); };
        });
        await page.locator('#copyEmailBtn').click();
        assert(await page.locator('#messageDetails').evaluate(element => element.open));
        assert.match(await page.locator('#copyEmailFeedback').textContent(), /selecionado/);
        assert.match(await page.locator('#outlookWarning').textContent(), /histórico é longo/);
        const unreadableHistory = await page.evaluate(async () => {
            const result = await extractOriginal(new Uint8Array([208, 207, 17, 224, 161, 177, 26, 225]).buffer, 'corrompido.msg');
            return prepareMessage({ ...cases[0], mainEmail: { ...cases[0].mainEmail, ...result } });
        });
        assert.match(unreadableHistory.warning, /Histórico não extraído/);
        await page.locator('#outlookBtn').click();
        await page.waitForFunction(() => window.sentLinks.length === 4);
        assert.equal(await page.locator('#fullEmailBody').inputValue(), mailto.searchParams.get('body').replace(/\r\n/g, '\n'));
        assert.equal(await page.locator('#outlookWarning').textContent(), '');
        assert(await page.locator('#responseSection').isHidden());
        await page.locator('#sentBtn').click();
        await page.locator('#responseSection').waitFor({ state: 'visible' });
        assert(await page.locator('#outcomeSection').isHidden());
        assert(await page.locator('#completeBtn').isHidden());
        const blocked = await page.evaluate(async () => {
            await transition(1, 4, 'Tentativa sem resposta');
            return { error: document.getElementById('detailError').textContent, stage: cases[0].stage };
        });
        assert.equal(blocked.stage, 1); assert.match(blocked.error, /Caso inválido/);
        await page.locator('#responseFile').setInputFiles(reply);
        await page.locator('#outcomeSection').waitFor({ state: 'visible' });
        await page.locator('input[value="resent"]').check();
        await page.locator('#outcomeForm button').click();
        assert(await page.locator('#completeBtn').isHidden());
        await page.locator('#address').fill('Rua das Amostras, 123 - São Paulo/SP');
        await page.locator('#recipient').fill('Maria - Recepção');
        await page.locator('#outcomeNotes').fill('Rastreio BR123');
        await page.locator('#outcomeForm button').click();
        await page.locator('#completeBtn').waitFor({ state: 'visible' });
        await page.locator('#completeBtn').click();
        await page.locator('#reactivateBtn').waitFor({ state: 'visible' });
        await page.locator('[data-close="detailDialog"]').click();
        assert.equal(await page.locator('#caseRows tr').count(), 0);
        await page.locator('#completedTab').click();
        assert.equal(await page.locator('#caseRows tr').count(), 1);
        await page.reload();
        await page.waitForFunction(() => !document.getElementById('newBtn').disabled);
        await page.locator('#completedTab').click();
        await page.locator('.case-link').click();
        assert.equal(await page.locator('.attachment').count(), 2);
        assert.match(await page.locator('#outcomeText').textContent(), /Maria - Recepção/);
        const attachmentDownload = page.waitForEvent('download');
        await page.locator('[data-download="principal"]').click();
        const originalDownload = await attachmentDownload;
        assert.deepEqual(await fs.readFile(await originalDownload.path()), email.buffer);
        await page.locator('#reactivateBtn').click();
        await page.locator('#outcomeSection').waitFor({ state: 'visible' });
        await page.locator('input[value="stock"]').check();
        await page.locator('#outcomeNotes').fill('=1+1');
        await page.locator('#outcomeForm button').click();
        await page.locator('#completeBtn').waitFor({ state: 'visible' });
        await page.locator('#completeBtn').click();
        await page.locator('#reactivateBtn').waitFor({ state: 'visible' });
        await page.locator('[data-close="detailDialog"]').click();
        const exportDownload = page.waitForEvent('download');
        await page.locator('#exportBtn').click();
        const downloaded = await exportDownload;
        const backupBuffer = await fs.readFile(await downloaded.path());
        const backup = JSON.parse(backupBuffer);
        assert.equal(backup.cases[0].stage, 4);
        assert.equal(backup.cases[0].outcome, 'stock');
        assert.equal(backup.cases[0].mainEmail.data.split(',')[1], email.buffer.toString('base64'));
        assert.match(backup.cases[0].mainEmail.originalText, /Amostra retornada pelo correio/);
        assert.equal(backup.cases[0].responseEmail.data.split(',')[1], reply.buffer.toString('base64'));
        await page.locator('#activeTab').click();
        assert.equal(await page.locator('#caseRows tr').count(), 0);
        const workbook = await readExcel(page);
        const dataSheet = workbook.getWorksheet('Devoluções');
        const historySheet = workbook.getWorksheet('Histórico');
        assert.equal(dataSheet.rowCount, 2);
        assert.equal(dataSheet.getCell('A2').value, backup.cases[0].id);
        assert.equal(dataSheet.getCell('C2').value, 'Amostra <script>segura</script>');
        assert.equal(dataSheet.getCell('D2').value, '346');
        assert.equal(dataSheet.getCell('E2').value, 'Cristiana Roseto');
        assert.equal(dataSheet.getCell('F2').value, 'CristianaRoseto@essentra.com');
        assert.equal(dataSheet.getCell('G2').value, 'BrazilWhse@essentra.com; EmersonSantos@essentra.com; BrazilSamples@essentra.com');
        assert.equal(dataSheet.getCell('H2').value, 4);
        assert.equal(dataSheet.getCell('I2').value, 'Concluído');
        assert.equal(dataSheet.getCell('J2').value, 'Voltou para estoque');
        assert.equal(dataSheet.getCell('M2').value, '=1+1');
        assert.equal(dataSheet.getCell('M2').type, ExcelJS.ValueType.String);
        assert.equal(dataSheet.getCell('N2').value.toISOString(), backup.cases[0].createdAt);
        assert.equal(dataSheet.getCell('P2').value, email.name);
        assert.equal(dataSheet.getCell('S2').value, reply.name);
        assert.equal(historySheet.rowCount, backup.cases[0].history.length + 1);
        assert.equal(historySheet.getCell('E2').value, backup.cases[0].history[0].action);
        assert.equal(dataSheet.views[0].ySplit, 1);
        assert(dataSheet.autoFilter);
        await page.locator('#completedTab').click();
        const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const mobile = await secondContext.newPage();
        await mobile.goto(url);
        await mobile.waitForFunction(() => !document.getElementById('newBtn').disabled);
        await mobile.locator('#importFile').setInputFiles({ name: 'backup-invalido.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup, cases: [{ ...backup.cases[0], responseEmail: null }] })) });
        await mobile.locator('#notice').filter({ hasText: 'Backup não importado' }).waitFor();
        assert.equal(await mobile.locator('#completedCount').textContent(), '0');
        mobile.on('dialog', dialog => dialog.accept());
        await mobile.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backupBuffer });
        await mobile.locator('#notice').filter({ hasText: 'restaurado' }).waitFor();
        await mobile.locator('#completedTab').click();
        assert.equal(await mobile.locator('#caseRows tr').count(), 1);
        await mobile.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backupBuffer });
        await mobile.locator('#notice').filter({ hasText: 'restaurado' }).waitFor();
        assert.equal(await mobile.locator('#caseRows tr').count(), 1);
        await mobile.locator('#search').fill('Pablo');
        assert.equal(await mobile.locator('#caseRows tr').count(), 0);
        await mobile.locator('#search').fill('Cristiana');
        assert.equal(await mobile.locator('#caseRows tr').count(), 1);
        const mobileWorkbook = await readExcel(mobile);
        assert.equal(mobileWorkbook.getWorksheet('Devoluções').rowCount, 2);
        for (const current of [page, mobile]) {
            await current.waitForFunction(() => {
                const logo = document.querySelector('.brand img');
                return logo && logo.complete && logo.naturalWidth > 0;
            });
            assert(await current.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        }
        assert(await mobile.locator('.badge').evaluate(element => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
        }));
        await mobile.screenshot({ path: '/tmp/devolucoes-mobile.png', fullPage: true });
        await page.screenshot({ path: '/tmp/devolucoes-desktop.png', fullPage: true });
        await mobile.locator('.case-link').click();
        assert.equal(await mobile.locator('.attachment').count(), 2);
        assert(await mobile.evaluate(() => {
            const dialog = document.getElementById('detailDialog');
            return dialog.scrollWidth <= dialog.clientWidth && dialog.getBoundingClientRect().right <= innerWidth;
        }));
        await mobile.screenshot({ path: '/tmp/devolucoes-detail-mobile.png', fullPage: true });
        assert.deepEqual(errors, []);
        console.log('PASS: cabeçalho sem link, histórico de MSG/EML/HTML, mensagem longa sem truncamento silencioso, cópia e fallback, backups antigos, nova mensagem no Outlook, controle de casos, persistência, backup JSON, Excel e layout desktop/mobile.');
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());