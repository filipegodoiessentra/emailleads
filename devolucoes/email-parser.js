import MsgReader from '@kenjiuno/msgreader';
import PostalMime from 'postal-mime';

function htmlToText(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script,style,iframe,object,embed,svg,canvas,head').forEach(element => element.remove());
    template.content.querySelectorAll('br').forEach(element => element.replaceWith(document.createTextNode('\n')));
    template.content.querySelectorAll('p,div,blockquote,li,tr,h1,h2,h3,h4,h5,h6,pre').forEach(element => {
        element.before(document.createTextNode('\n'));
        element.after(document.createTextNode('\n'));
    });
    return template.content.textContent.replace(/\u00a0/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function addresses(items = []) {
    return items.map(item => {
        if (item.group) return addresses(item.group);
        const address = item.address || item.smtpAddress || item.email || '';
        return item.name && address && item.name !== address ? `${item.name} <${address}>` : item.name || address;
    }).filter(Boolean).join('; ');
}
function historyText({ from, to, cc, date, subject, body, attachments = [] }) {
    if (!body || !body.trim()) throw new Error('O e-mail não contém um corpo de texto ou HTML legível. Abra o original no Outlook para conferir o conteúdo.');
    const lines = ['----- E-mail original -----', `De: ${from || 'Não informado'}`];
    if (to) lines.push(`Para: ${to}`);
    if (cc) lines.push(`Cc: ${cc}`);
    if (date) lines.push(`Data: ${date}`);
    lines.push(`Assunto: ${subject || '(sem assunto)'}`);
    if (attachments.length) lines.push(`Anexos do original (não anexados automaticamente): ${attachments.join('; ')}`);
    return [...lines, '', body.trimEnd()].join('\n').replace(/\r\n?/g, '\n');
}
export async function extractHistory(buffer, filename) {
    if (/\.eml$/i.test(filename)) {
        const email = await PostalMime.parse(buffer);
        return historyText({
            from: addresses(email.from ? [email.from] : []), to: addresses(email.to), cc: addresses(email.cc),
            date: email.date, subject: email.subject,
            body: email.text?.trim() ? email.text : htmlToText(email.html || ''),
            attachments: email.attachments.map(attachment => attachment.filename || 'Anexo sem nome')
        });
    }
    const reader = new MsgReader(buffer);
    const email = reader.getFileData();
    if (email.error || email.dataType !== 'msg') throw new Error('Não foi possível ler o conteúdo deste arquivo MSG. Abra o original no Outlook para conferir o histórico.');
    const headers = email.headers ? await PostalMime.parse(`${email.headers}\r\n\r\n`) : {};
    let html = email.bodyHtml || '';
    if (!html && email.html) {
        try { html = new TextDecoder('utf-8', { fatal: true }).decode(email.html); }
        catch { html = new TextDecoder('windows-1252').decode(email.html); }
    }
    return historyText({
        from: addresses(headers.from ? [headers.from] : [{ name: email.senderName, address: email.senderSmtpAddress || email.senderEmail }]),
        to: addresses(headers.to) || addresses(email.recipients?.filter(recipient => recipient.recipType !== 'cc' && recipient.recipType !== 'bcc')),
        cc: addresses(headers.cc) || addresses(email.recipients?.filter(recipient => recipient.recipType === 'cc')),
        date: headers.date || email.clientSubmitTime || email.messageDeliveryTime, subject: email.subject || headers.subject,
        body: email.body?.trim() ? email.body : htmlToText(html),
        attachments: (email.attachments || []).map(attachment => attachment.fileName || attachment.fileNameShort || 'Anexo sem nome')
    });
}