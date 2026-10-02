# emailleads

Aplicações estáticas publicadas pelo GitHub Pages.

## Devoluções de amostras

Acesse `/devolucoes/` no mesmo endereço do dashboard. Se o site estiver em um
subdiretório do GitHub Pages, mantenha esse prefixo: `/<repositorio>/devolucoes/`.
O acesso sem a barra final (`/devolucoes`) é redirecionado pelo servidor estático.

- Primeiro insira o e-mail principal do Outlook (`.msg` ou `.eml`). Depois selecione
	o vendedor, usando os mesmos números, nomes e endereços do dashboard existente.
- Salvar e abrir no Outlook cria um caso com envio pendente e abre uma mensagem
	nova com vendedor, cópias, assunto, texto padrão e histórico textual do e-mail
	principal preenchidos, quando legível e dentro do limite do link. Após enviar no Outlook,
	confirme o envio no caso para registrar **1. E-mail enviado**.
- Inserir o arquivo da resposta do vendedor registra **2. Resposta recebida**.
	Sem esse e-mail não é possível registrar destino nem concluir.
- Registre **3. Reenviado / Voltou para estoque**. O reenvio exige endereço
	confirmado e destinatário/recebedor responsável.
- **4. Concluído** move o caso para a seção Concluídos, sem excluir os arquivos ou
	o histórico. Reativar retorna à etapa de resposta recebida para rever o destino.

O Outlook é aberto via `mailto:` para criar uma mensagem nova. Ao inserir o
e-mail principal, o app extrai seu corpo de texto (ou converte HTML para texto)
e acrescenta remetente, destinatários, data e assunto abaixo da mensagem padrão.
Isso inclui o histórico anterior que já estiver no corpo do e-mail arrastado;
não consulta outras mensagens da conversa na caixa de entrada.

Não é um encaminhamento nativo: formatação, imagens e arquivos anexados não são
transportados pelo `mailto:`. Os nomes dos anexos são indicados no histórico,
mas os arquivos precisam ser anexados separadamente no Outlook.

O limite conservador para a URL codificada é de 2.000 caracteres. Quando a mensagem
completa excede esse limite, o Outlook abre somente com o texto padrão e o app
exibe um aviso. Use **Copiar mensagem completa** e substitua o corpo no Outlook;
o histórico não é cortado. O texto também está disponível em **Mensagem completa
com histórico**, inclusive para seleção manual se o navegador bloquear a cópia.
O limite real pode variar conforme navegador, sistema e versão do Outlook.

Arquivos protegidos, danificados ou MSG com apenas corpo RTF podem não permitir
extração. Nesses casos, o app avisa e mantém o original para conferência no Outlook,
sem alegar que o histórico foi incluído. Backups antigos sem texto extraído continuam
compatíveis: a leitura do original é feita ao abrir a mensagem do caso.

O navegador não confirma o envio nem acessa a caixa de entrada.
Os e-mails inseridos continuam salvos no caso e no backup JSON e podem
ser baixados no formato original. Caso sua versão do Outlook não
disponibilize um arquivo ao arrastar, salve a mensagem como `.msg` ou `.eml` e
selecione o arquivo. O limite é de 20 MB por e-mail.

Ao abrir um caso, a seção **E-mails do caso** exibe o conteúdo textual do e-mail
principal e da resposta do vendedor, incluindo os cabeçalhos extraídos. A leitura
continua disponível nos casos concluídos e restaurados de backup. O conteúdo pode
ser expandido ao clicar em **Conteúdo do e-mail** e começa recolhido por padrão.
As linhas de cabeçalho em português e inglês (como De, From, Sent, Cc e Subject)
aparecem em negrito, sem interpretar o HTML do e-mail.
O download do original permanece disponível. Se o arquivo não
puder ser lido, a seção informa a limitação e oferece o original para abrir no Outlook.

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

A extração utiliza PostalMime 4.0.2 e @kenjiuno/msgreader 1.28.0, empacotados
localmente em `devolucoes/email-parser.min.js` a partir de `devolucoes/email-parser.js`.
As licenças desses leitores e das dependências estão em
`devolucoes/email-parser-licenses.zip`. O arquivo `tests/historico.msg` é a amostra
pública `test/test1.msg` do projeto `HiraokaHyperTools/msgreader` (Apache-2.0),
usada exclusivamente para testar a leitura do formato MSG.

Para reconstruir o leitor depois de alterar seu código:

```sh
npm install --prefix /tmp/emailleads-checks @kenjiuno/msgreader@1.28.0 postal-mime@4.0.2 esbuild
NODE_PATH=/tmp/emailleads-checks/node_modules /tmp/emailleads-checks/node_modules/.bin/esbuild devolucoes/email-parser.js --bundle --platform=browser --format=iife --global-name=EmailParser --minify --legal-comments=inline --outfile=devolucoes/email-parser.min.js
```

## Verificação

`node --check devolucoes/app.js` verifica a sintaxe sem instalar dependências.
O teste de navegador em `tests/devolucoes.cjs` utiliza Playwright e inicia/encerra
seu próprio servidor HTTP temporário:

```sh
npm install --prefix /tmp/emailleads-checks playwright exceljs@4.4.0
/tmp/emailleads-checks/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/emailleads-checks/node_modules node tests/devolucoes.cjs
```