const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

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
        const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(filename)];
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
        await page.evaluate(() => {
            window.sentLinks = [];
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                if (this.href.startsWith('mailto:')) { window.sentLinks.push(this.href); return; }
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
        assert.equal(mailto.searchParams.get('body'), 'Boa Tarde Cristiana,\r\n\r\nRecebemos o retorno via correio dessa amostra. \r\nFavor informar imediatamente se vai ser reenviado ou deve voltar para o estoque.\r\nCaso reenviado, favor confirmar o endereço e os dados do destinatário/recebedor responsável. \r\n\r\nAguardamos seu retorno.');
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
        assert.equal(backup.cases[0].responseEmail.data.split(',')[1], reply.buffer.toString('base64'));
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
        for (const current of [page, mobile]) {
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
        console.log('PASS: rota, e-mail obrigatório, vendedores, mailto, bloqueios, reenvio, estoque, conclusão, reativação, persistência, anexos, backup/restauração, validação, busca e layout desktop/mobile.');
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());