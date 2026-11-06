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
  Dentro do bloco, `{{@n}}` é o número da linha (1, 2, 3…).

Na importação você mapeia a coluna do nome, a do e-mail e (opcional) a coluna
de agrupamento. Agrupando por `CODVEND`, por exemplo, cada vendedor vira um
destinatário com as suas linhas — e recebe um único e-mail só com os dados dele.

Exemplo de descrição para o top-5 por vendedor:

```text
Olá, {{VENDEDOR}}! Segue o resumo dos seus 5 maiores clientes:
{{#linhas}}
{{POSICAO}} - {{RAZAOSOCIAL}} - R$ {{VLR_TOTAL}}
{{/linhas}}
```

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
  e colher a assinatura física — e cada PDF traz o link digital dentro.
- Quando o cliente assina pelo link, a cópia em PDF vai para a **empresa**,
  para o **cliente** e para o **vendedor** (e-mail cópia).
- O botão **Clientes (x/y)** ao lado do contato abre o status por cliente
  e copia cada link individual.
- A seção **Mensagem do cliente** (segundo menu dentro da campanha) guarda os
  textos do cliente, com as variáveis da linha (`{{COLUNA}}`, `{{NOME}}`,
  `{{EMAIL}}` e `{{link}}` para o próprio link): a mensagem do link de
  assinatura e o texto que vai em cada PDF dele. Vazio, o PDF usa a mensagem
  do cliente; ambas vazias, vale a descrição principal.
- Grupos sem e-mail cópia são pulados e listados como ignorados.

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
formato); coloridos só na tela e no e-mail.
