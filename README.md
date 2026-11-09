# Envio de formulários em massa

Ferramenta web para enviar formulários com assinatura por e-mail para muitos clientes de uma vez.

**Como funciona:**

1. Você cria uma **campanha** (título + descrição).
2. Importa uma **planilha CSV**, mapeia as colunas de nome, e-mail e
   agrupamento (opcional, para várias linhas por destinatário).
3. **Dispara** — cada cliente recebe um e-mail com um link individual.
4. O cliente abre o link, confere os dados, **digita o nome como assinatura** e envia.
5. A **cópia preenchida em PDF** vai anexada ao seu e-mail e ao do cliente.
   O texto do e-mail só avisa que a assinatura foi recebida.

## Rodando

Pré-requisito: [Node.js](https://nodejs.org) 24 (LTS) ou superior.

```bash
cd envio-formularios-massa
npm install
npm start
```

Abra no navegador: **http://localhost:3000**

## Configurando o envio (SMTP)

Na primeira tela do painel, preencha:

| Campo     | Exemplo                                            |
| --------- | -------------------------------------------------- |
| Servidor  | `smtp.gmail.com`, `smtp.office365.com`, etc.       |
| Porta     | `587` (ou `465`)                                   |
| Usuário   | seu e-mail                                         |
| Senha     | sua senha ou **senha de app** (Gmail/Outlook exigem) |
| Remetente | e-mail que aparece como remetente                  |

Também dá para pré-configurar pelo arquivo `.env` (copie do `.env.example`).
Use o botão **Enviar teste** para confirmar antes do disparo real.

Sem SMTP configurado, o sistema roda em **modo teste**: os e-mails ficam
registrados no log visível no painel, sem envio real.

## Planilha de contatos

Arquivo **CSV** com qualquer coluna. A primeira linha deve ter os nomes das
colunas (ou desmarque "primeira linha é cabeçalho" para usar Coluna 1, 2…).
Na importação você escolhe qual coluna é o nome, qual é o e-mail e por qual
agrupar (opcional).

```csv
CODVEND;VENDEDOR;EMAIL;POSICAO;RAZAOSOCIAL;VLR_TOTAL
961;KECK;keck@exemplo.com;1;PATOESTE LTDA;56316.99
961;KECK;keck@exemplo.com;2;MULTI ACO LTDA;24834.73
```

No Excel: **Arquivo → Salvar como → CSV UTF-8**. Funciona com `;` ou `,`.
Duplicados e e-mails inválidos são ignorados. Grupos sem e-mail são listados
e pulados.

## Editando, excluindo e reenviando

- Dentro da campanha, **Editar campanha** muda título, descrição e e-mail de
  retorno; os próximos envios e reenvios usam os novos dados.

- Na lista de campanhas, **Excluir** apaga a campanha e seus contatos (pede confirmação).
- Dentro da campanha, **Apagar contatos e assinaturas** remove todos os
  contatos, links por cliente e assinaturas, mas mantém a campanha —
  útil para corrigir a planilha e reimportar do zero.
- Dentro da campanha, **Reenviar** ao lado de um contato manda o convite de novo para ele.
- **Reenviar para todos não assinados** manda de novo para quem ainda não assinou,
  inclusive quem já tinha recebido. Quem já assinou nunca recebe reenvio.

## Variáveis e agrupamento

A descrição da campanha aceita variáveis das colunas da planilha:

- `{{COLUNA}}` — valor da coluna (da primeira linha do destinatário).
  Ex.: `{{VENDEDOR}}`, `{{RAZAOSOCIAL}}`. `{{NOME}}` e `{{EMAIL}}` sempre existem.
- `{{#linhas}} … {{/linhas}}` — repete o trecho para cada linha do destinatário.
  Dentro do bloco, `{{@n}}` é o número da linha (1, 2, 3…) e `{{@n0}}`
  com zero à esquerda (01, 02…). `{{@total}}` é a quantidade de linhas.
- `{{moeda:COLUNA}}` — valor em R$ pt-BR (aceita número americano e
  brasileiro: `56,316.99` e `56.316,99` saem `R$ 56.316,99`).
- `{{primeiro:COLUNA}}` — primeiro nome (`982 - PEDRO MEN` sai `Pedro`).
- `{{CRESCIMENTO}}` (por linha), `{{TOTAL_FATURADO}}`, `{{TOTAL_META}}` e
  `{{TOTAL_CRESCIMENTO}}` (do grupo) — calculados de `VLR_TOTAL`/`VLR_NOVO`
  quando a planilha não tem essas colunas. Combine com `moeda:`.
  Coluna própria da planilha sempre vence o cálculo.

Na importação você mapeia a coluna do nome, a do e-mail e (opcional) a coluna
de agrupamento. Agrupando por `CODVEND`, por exemplo, cada vendedor vira um
destinatário com as suas linhas — e recebe um único e-mail só com os dados dele.

Exemplo de descrição para o top-5 por vendedor:

```text
Olá, {{VENDEDOR}}! Segue o resumo dos seus 5 maiores clientes:
{{#linhas}}
{{POSICAO}} - {{RAZAOSOCIAL}} - {{moeda:VLR_TOTAL}}
{{/linhas}}
```

No formato HTML, se a descrição for um documento completo (contém `<html>`),
ela vira o corpo inteiro do e-mail, sem a moldura padrão (título, saudação
e botão). Use `cid:banner` / `cid:logo` no `src` das imagens para puxar a
imagem e o logo cadastrados na campanha. O arquivo
`email_gaya_cashback_dinamico.html` é um modelo pronto nesse formato.

Use o botão **Prévia** ao lado de cada contato para conferir o e-mail
renderizado antes de disparar.

## Vendedores: PDFs por cliente e e-mail cópia

Com agrupamento (ex.: por `CODVEND`), mapeie também na importação:

- **E-mail cópia** (obrigatório com agrupamento) — o vendedor; é para onde
  vai o convite e a cópia de cada assinatura, para ele não perder o controle.
- **E-mail do cliente** (opcional) — preenche o e-mail de cada linha; se ficar
  vazio, o cliente informa na hora de assinar.
- **Nome do cliente nas linhas** — nome que identifica cada PDF e cada link.

O que acontece:

- Cada linha ganha um **link individual** de assinatura. Use `{{link}}` dentro
  do bloco `{{#linhas}}` para colocá-lo ao lado do nome do cliente no e-mail,
  e o vendedor encaminha cada um. Sem link próprio, `{{link}}` usa o do contato.
- O convite do vendedor leva **um PDF por linha** (`formulario-1-nome.pdf`,
  `formulario-2-nome.pdf`…), com os dados só daquele cliente, para imprimir
  e colher a assinatura física. O PDF não traz link digital.
- Quando o cliente assina pelo link, a cópia em PDF vai para a **empresa**,
  para o **cliente** e para o **vendedor** (e-mail cópia).
- O botão **Clientes (x/y)** ao lado do contato abre o status por cliente
  e copia cada link individual.
- A seção **Mensagem do cliente** (segundo menu dentro da campanha) guarda os
  textos do cliente, com as variáveis da linha (`{{COLUNA}}`, `{{NOME}}`,
  `{{EMAIL}}` e `{{link}}` para o próprio link): a mensagem do link de
  assinatura e, no layout livre, o texto do PDF. Variável sem dado na
  planilha sai em branco.
- Grupos sem e-mail cópia são pulados e listados como ignorados.
- Com o **botão do vendedor desligado** (opção na criação/edição), o convite
  do vendedor sai sem o botão de assinar e o link dele não aceita assinatura
  — o botão aparece somente para o cliente.
- O **formato** da campanha pode ser **só texto** ou **HTML**: em HTML a
  descrição aceita tags (`<b>`, `<br>`, `<a href>`, tabelas…) e o e-mail sai
  estilizado; os dados da planilha continuam escapados e no PDF as tags
  viram texto simples.
- A **assinatura** pode começar **preenchida com o nome** ou **vazia** (opção
  na criação/edição); vazia, o cliente digita — o envio continua exigindo texto.

## Layout do PDF (Termo de Adesão)

Por padrão o PDF sai no layout de termo (5 seções numeradas, 1 página):
dados do cliente, meta, benefícios, condições e assinatura. Os valores vêm
da linha da planilha:

- **CLIENTE** — nome do contato; **E-MAIL** — e-mail (ou "(não informado)").
- **CNPJ** — colunas `CNPJ` ou `CNPJ_MATRIZ`.
- **REPRESENTANTE** — `REPRESENTANTE`, `REPRESENTANTE_GAYA` ou `VENDEDOR`.
- **FATURAMENTO** — `VLR_TOTAL`, `FATURAMENTO`, `VALOR_TOTAL` ou `VLR` (vira R$).
- **META** — `META`, `VLR_META` ou `META_CLIENTE`; sem ela, calcula +10%
  sobre o faturamento.
- Textos de apoio (`MES_REF`, `MES_META`, `MES_APURACAO`, `PERIODO`,
  `DATA_LIMITE`, `CASHBACK`, `PCT_META`) têm o padrão da campanha cashback e
  podem ser sobrescritos por colunas com esses nomes.
- A faixa do cabeçalho usa o campo **Destaque** (vazio, some).

O campo **Layout do PDF** troca para **livre** (texto corrido da descrição,
com imagem, logo e alinhamentos configuráveis). O termo usa posições fixas
e ignora posição do logo e alinhamento do título.

## Imagem e logotipo da campanha

- **Imagem**: aparece acima da descrição no e-mail, no formulário e no PDF.
- **Logotipo**: aparece ao lado do título; você escolhe o alinhamento do
  título (esquerda, centro ou direita) e se o logo vem antes ou depois do texto.
- Ambos aceitam PNG ou JPG de até 2 MB, enviados na criação ou na edição
  da campanha. A imagem pode ficar à esquerda, no centro ou à direita.

## Usuários e login

Só o painel é protegido — o link de assinatura do cliente continua público.

- No primeiro acesso, crie o usuário administrador na tela de login.
- Depois, gerencie a equipe na seção **Usuários** do painel.
- Sessões duram 12 horas e se renovam com o uso.

## Publicando na internet (para os clientes acessarem)

Enquanto rodar só no seu PC, os clientes não conseguem abrir os links.
Opções:

- **Teste rápido:** exponha temporariamente com [ngrok](https://ngrok.com)
  (`ngrok http 3000`) e use o endereço gerado no campo
  **Endereço público da ferramenta**.
- **Produção:** publique em um servidor (VPS) ou plataforma como
  Render, Railway ou similar, com Node.js 20+. Ajuste no servidor:
  - `HOST=0.0.0.0` (aceitar conexões externas)
  - `BASE_URL=https://seu-endereco-publico` (vai nos links dos e-mails)

Passo a passo completo para VPS com Portainer (Docker + HTTPS automático):
veja o [DEPLOY.md](DEPLOY.md).

## Dados

Tudo fica no arquivo `data/app.db` (SQLite, criado automaticamente).
Para recomeçar do zero, apague esse arquivo com o servidor desligado.
Para testes com banco separado, suba com `DB_PATH=caminho\teste.db`.

As fontes Lato (texto), Alex Brush (assinatura) e Noto Emoji ficam em
`public/fonts/`, vão embutidas no PDF e são distribuídas sob a licença SIL
Open Font License. No PDF os emojis saem em preto e branco (limitação do
formato); coloridos só na tela e no e-mail. O PDF sempre sai em uma única
página: com texto longo a letra diminui e, em último caso, o texto é
cortado com ….
