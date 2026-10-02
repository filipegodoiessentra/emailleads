# emailleads

Aplicações estáticas publicadas pelo GitHub Pages.

## Devoluções de amostras

Acesse `/devolucoes/` no mesmo endereço do dashboard. Se o site estiver em um
subdiretório do GitHub Pages, mantenha esse prefixo: `/<repositorio>/devolucoes/`.
O acesso sem a barra final (`/devolucoes`) é redirecionado pelo servidor estático.

- Primeiro insira o e-mail principal do Outlook (`.msg` ou `.eml`). Depois selecione
	o vendedor, usando os mesmos números, nomes e endereços do dashboard existente.
- Salvar e abrir no Outlook cria um caso com envio pendente. Envie no Outlook e
	confirme o envio no caso para registrar **1. E-mail enviado**.
- Inserir o arquivo da resposta do vendedor registra **2. Resposta recebida**.
	Sem esse e-mail não é possível registrar destino nem concluir.
- Registre **3. Reenviado / Voltou para estoque**. O reenvio exige endereço
	confirmado e destinatário/recebedor responsável.
- **4. Concluído** move o caso para a seção Concluídos, sem excluir os arquivos ou
	o histórico. Reativar retorna à etapa de resposta recebida para rever o destino.

O Outlook é aberto via `mailto:`, como no gerador existente. O navegador não
confirma o envio, não acessa a caixa de entrada e não anexa automaticamente o
e-mail principal à mensagem de saída. Os e-mails inseridos ficam associados ao
caso e podem ser baixados no formato original. Caso sua versão do Outlook não
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

## Verificação

`node --check devolucoes/app.js` verifica a sintaxe sem instalar dependências.
O teste de navegador em `tests/devolucoes.cjs` utiliza Playwright e inicia/encerra
seu próprio servidor HTTP temporário:

```sh
npm install --prefix /tmp/emailleads-checks playwright
/tmp/emailleads-checks/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/emailleads-checks/node_modules node tests/devolucoes.cjs
```