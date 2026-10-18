[README.md](https://github.com/user-attachments/files/33632831/README.md)
# Monitora UPA — Protótipo

Protótipo web (HTML + CSS + JS puro, sem framework) que reproduz as 3 telas do mockup:

1. **Check-in** — notificação perguntando se o paciente chegou na UPA
2. **Check-out** — notificação perguntando se o atendimento terminou, com tempo de permanência
3. **Início** — lista das UPAs próximas, ordenável por tempo médio de espera ou distância

Como é um protótipo, há uma **barra preta fixa no rodapé** só para navegar manualmente entre as 3 telas durante os testes (numa versão real, a troca de tela seria automática, via geolocalização).

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura das 3 telas |
| `style.css` | Todo o visual (cores, cards, botões) |
| `app.js` | Relógio, geolocalização, navegação e chamadas ao Supabase |
| `supabase-schema.sql` | Cria as tabelas `upas` e `atendimentos` no Supabase |

## 1. Configurar o banco no Supabase

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. No painel, vá em **SQL Editor** → **New query**.
3. Cole o conteúdo de `supabase-schema.sql` e clique em **Run**.
4. Vá em **Project Settings → API** e copie:
   - **Project URL**
   - **anon public key**
5. Abra `app.js` e substitua as duas primeiras linhas:

```js
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA-CHAVE-ANON-PUBLICA';
```

## 2. Rodar localmente (Windows / PowerShell)

Abrir o `index.html` direto no navegador (duplo clique) **não funciona bem**, porque geolocalização e alguns recursos do navegador exigem que a página seja servida por um endereço `http://` (não `file://`). Use um servidor local simples:

### Opção A — Python (se já tiver instalado)

```powershell
cd C:\caminho\para\a\pasta\do\projeto
python -m http.server 5500
```

Depois abra no navegador: `http://localhost:5500`

### Opção B — Node.js (sem precisar instalar nada globalmente)

```powershell
cd C:\caminho\para\a\pasta\do\projeto
npx serve -l 5500
```

Depois abra: `http://localhost:5500`

## 3. Testar no celular de verdade

Duas opções:

**A) Mesma rede Wi-Fi (mais simples, mas geolocalização pode não funcionar)**

```powershell
ipconfig
```

Pegue o "Endereço IPv4" do seu PC (ex: `192.168.0.10`) e, no navegador do celular (mesma Wi-Fi), acesse:

```
http://192.168.0.10:5500
```

> ⚠️ A API de geolocalização do navegador só funciona em `localhost` ou em conexões **https**. Acessando por IP local via `http://`, o navegador do celular provavelmente vai bloquear a localização — a distância aparecerá como "indisponível", mas o resto do app funciona normalmente.

**B) Túnel HTTPS (recomendado para testar geolocalização de verdade)**

```powershell
npx localtunnel --port 5500
```

Isso gera um link `https://algumacoisa.loca.lt` que você pode abrir direto no celular, de qualquer rede, com HTTPS — e aí a geolocalização funciona.

## 4. Criar a estrutura de pastas do zero (opcional)

Se quiser recriar o projeto do zero via PowerShell:

```powershell
New-Item -ItemType Directory -Path "monitora-upa"
Set-Location "monitora-upa"
New-Item index.html, style.css, app.js, supabase-schema.sql, README.md -ItemType File
```

Depois é só colar o conteúdo de cada arquivo gerado.

## Sobre o fluxo do protótipo

- Ao tocar em um card de UPA na tela **Início**, você vai para a tela de **Check-in** daquela UPA.
- Escolhendo **"Sim"** e depois **"Confirmar horário"**, é criado um registro `em_andamento` na tabela `atendimentos` e salvo um "atendimento ativo" no `localStorage` do navegador.
- Tocando em **🚪 Check-out** na barra de baixo, o app calcula o tempo decorrido desde a chegada e mostra a tela de saída.
- **"Sim, finalizado"** grava `horario_saida` e `tempo_permanencia_minutos`, o que passa a contar na média de tempo de espera exibida na lista.
- **"Não, desisti"** marca o atendimento como `desistiu` (não conta pra média, mas fica no histórico).

## Observação sobre a logo

O mockup enviado usa a marca "UPA 24h SEM FILA". Para o protótipo, troquei por um ícone genérico de cruz de saúde (SVG simples embutido no HTML), para não reproduzir uma marca/logo de terceiros. Troque por sua própria logo quando for para produção.
