# emailleads

Aplicações estáticas publicadas pelo GitHub Pages.

## Devoluções de amostras

Acesse `/devolucoes/` no mesmo endereço do dashboard. Se o site estiver em um
subdiretório do GitHub Pages, mantenha esse prefixo: `/<repositorio>/devolucoes/`.
O acesso sem a barra final (`/devolucoes`) é redirecionado pelo servidor estático.

- Primeiro insira o e-mail principal do Outlook (`.msg` ou `.eml`). Depois selecione
	o vendedor, usando os mesmos números, nomes e endereços do dashboard existente.
- Salvar e baixar original cria um caso com envio pendente e baixa o mesmo e-mail,
	sem alterar seu conteúdo. Abra-o no Outlook, use **Encaminhar** e cole o texto
	e os destinatários disponíveis nos botões de cópia. Após enviar, confirme o
	encaminhamento no caso para registrar **1. E-mail enviado**.
- Inserir o arquivo da resposta do vendedor registra **2. Resposta recebida**.
	Sem esse e-mail não é possível registrar destino nem concluir.
- Registre **3. Reenviado / Voltou para estoque**. O reenvio exige endereço
	confirmado e destinatário/recebedor responsável.
- **4. Concluído** move o caso para a seção Concluídos, sem excluir os arquivos ou
	o histórico. Reativar retorna à etapa de resposta recebida para rever o destino.

Não é criada uma mensagem nova via `mailto:` no aplicativo de devoluções.
O encaminhamento é feito manualmente no Outlook a partir do e-mail original,
preservando o histórico da mensagem e os anexos conforme o comportamento do
Outlook. O app não abre o arquivo automaticamente, não confirma o envio e não
acessa sua caixa de entrada. Encaminhamento automático exigiria autenticação
Microsoft 365 e permissões configuradas no Microsoft Entra ID.
Os e-mails inseridos ficam associados ao caso e podem ser baixados no formato
original. Caso sua versão do Outlook não
disponibilize um arquivo ao arrastar, salve a mensagem como `.msg` ou `.eml` e
selecione o arquivo. O limite é de 20 MB por e-mail.

## Armazenamento e backup

Casos, histórico e e-mails originais são salvos automaticamente no **IndexedDB**
do navegador, inclusive após fechar a página. Não há servidor de dados nem
sincronização entre computadores, perfis ou navegadores. Limpar os dados do site
ou usar navegação privada pode apagar os registros.

**Backup JSON** baixa todos os casos, inclusive concluídos, com os e-mails completos.
Guarde o arquivo em local seguro: ele contém dados e anexos dos e-mails.
O download do backup é manual; o navegador não grava um arquivo JSON externo
automaticamente. Faça backups regulares, especialmente antes de limpar o navegador.

**Restaurar** valida o arquivo e pede confirmação. Casos com o mesmo ID são
substituídos pelo backup; os outros casos locais são preservados. O limite de
importação é de 200 MB. Backups maiores podem ser arquivados, mas não restaurados
por esta versão.

## Exportação Excel

O botão **Excel** baixa um arquivo `.xlsx` com todos os casos, inclusive concluídos,
independentemente da seção, busca ou filtro visível. A aba **Devoluções** contém os
dados do caso, vendedor, destinatários, etapa/status, destino, endereço, recebedor,
observações, datas e nomes/tamanhos dos e-mails. A aba **Histórico** contém os
eventos de cada caso. As datas da planilha são identificadas em UTC.

As abas têm cabeçalho congelado e filtros. Campos de texto são exportados como
texto, não como fórmulas. Os arquivos originais dos e-mails não são embutidos no
Excel: para preservar/restaurar os casos completos, continue usando o backup JSON.
Assim como o backup, a planilha contém dados corporativos e deve ser guardada em
local seguro.

A geração do Excel usa ExcelJS 4.4.0, distribuído localmente em
`devolucoes/exceljs.min.js`, com licença em `devolucoes/exceljs.LICENSE`.
Origem: `https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js`.

## Verificação

`node --check devolucoes/app.js` verifica a sintaxe sem instalar dependências.
O teste de navegador em `tests/devolucoes.cjs` utiliza Playwright e inicia/encerra
seu próprio servidor HTTP temporário:

```sh
npm install --prefix /tmp/emailleads-checks playwright exceljs@4.4.0
/tmp/emailleads-checks/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/emailleads-checks/node_modules node tests/devolucoes.cjs
```