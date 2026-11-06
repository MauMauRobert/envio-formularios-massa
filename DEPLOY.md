# Subindo na VPS com Portainer

O que vai ao ar: o app (Node) + o Caddy como proxy reverso, que emite
o HTTPS do seu domínio sozinho. O banco SQLite fica num volume Docker,
então sobrevive a atualizações.

Pré-requisitos: uma VPS com Ubuntu 22.04/24.04 (1 vCPU + 1 GB já serve)
e um domínio (ex.: `forms.suaempresa.com`) com acesso ao DNS.

## 1. DNS

No painel do seu domínio, crie um registro **A**:

- Nome/host: `forms` (ou o subdomínio que quiser)
- Valor: o IP da VPS

Aguarde propagar (teste com `ping forms.suaempresa.com` — tem que
responder o IP da VPS).

## 2. Docker + Portainer na VPS

Conecte por SSH e rode:

```bash
curl -fsSL https://get.docker.com | sh
docker volume create portainer_data
docker run -d -p 8000:8000 -p 9443:9443 --name portainer --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data \
  portainer/portainer-ce:latest
```

Libere o firewall:

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 9443 && ufw --force enable
```

Abra `https://IP-DA-VPS:9443` (aceite o aviso de certificado), crie o
usuário admin do Portainer e escolha **Get Started** no ambiente local.

## 3. Código num repositório git

O Portainer monta a stack a partir do git. Suba a pasta do projeto
(ela já contém `Dockerfile`, `docker-compose.yml` e `Caddyfile`) para
um repositório privado no GitHub/GitLab/etc.:

```bash
cd envio-formularios-massa
git init && git add -A && git commit -m "envio de formulários"
git remote add origin <url-do-repo> && git push -u origin main
```

Não suba o `data/app.db` local nem o `.env` com senhas (use `.gitignore`).

## 4. Criar a stack no Portainer

1. No Portainer: **Stacks → Add stack**, nome `formularios`.
2. Em **Build method**, escolha **Repository**: URL do repo, e em
   **Compose path** o caminho do `docker-compose.yml` dentro do repo
   (se o repo é só a pasta do projeto, deixe `docker-compose.yml`).
3. Em **Environment variables**, adicione:
   - `DOMINIO` = `forms.suaempresa.com`
   - `BASE_URL` = `https://forms.suaempresa.com`
4. Clique em **Deploy the stack**. Na primeira vez o Caddy emite o
   certificado (pode levar 1–2 minutos).

## 5. Primeiro acesso

1. Abra `https://forms.suaempresa.com` → crie o usuário administrador.
2. No painel, configure o **SMTP** e confira o **Endereço público da
   ferramenta** (tem que ser o `https://...` — é ele que vai nos links).
3. Use **Enviar teste** antes do primeiro disparo real.

## 6. Atualizações

Mudou o código? Faça push para o repo e no Portainer abra a stack,
ative **Re-pull image**/rebuild em **Update the stack** (ou
**Pull and redeploy**). O banco no volume `app-data` é preservado.

## 7. Backup

O que importa é o `data/app.db` dentro do volume `app-data`. Opções:

- Portainer: **Volumes → app-data... → Browse**, baixe o `app.db`.
- Ou via SSH: `docker run --rm -v <stack>_app-data:/v -v $(pwd):/b alpine cp /v/app.db /b/app-$(date +%F).db`

## Problemas comuns

- **Site não abre / certificado falha**: confira DNS apontando para a VPS
  e portas 80/443 liberadas. Veja o log: stack → container `caddy` → Logs.
- **Links do e-mail com endereço errado**: ajuste `BASE_URL` (variável da
  stack + campo no painel) para o `https://...` final.
- **E-mail não sai**: confira SMTP no painel; portas 587/465 geralmente
  funcionam em VPS (a 25 costuma ser bloqueada — não a usamos).
- **Esqueci a senha do admin**: via SSH, pare a stack e apague o usuário
  para refazer o setup: `docker run --rm -v <stack>_app-data:/v alpine sh -c "apk add --no-cache sqlite && sqlite3 /v/app.db \"DELETE FROM usuarios; DELETE FROM sessoes;\""` e suba de novo.
