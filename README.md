# ✊ ✋ ✌️ Jokenpo

Pedra, papel e tesoura contra o computador, **jogado com a mão** pela webcam.
Roda no navegador (MediaPipe) e é publicado no Vercel; o vídeo é processado localmente e nunca é enviado a servidor.

## Como jogar
1. **Ativar câmera** — o navegador pede a permissão na primeira vez.
2. **Escolha o nível** apontando o indicador para um cartão e segurando por ~1 s (ou clique com o mouse / pinça):

| Nível | Computador | Contagem |
|---|---|---|
| 🌱 **Aprendiz** | joga aleatório | lenta (0,9 s por tempo) |
| ⚔️ **Jovem** | percebe qual jogada você mais repete e a contra-ataca (50 % das vezes) | 0,7 s |
| 🐉 **Mestre** | lê padrões de sequência (suas últimas jogadas e o resultado anterior) e contra-ataca (85 %) | 0,55 s |

3. **Jogue:** a tela conta *PEDRA… PAPEL… TESOURA… JÁ!* e você mostra a mão quando aparecer **JÁ!**

| Gesto | Jogada |
|---|---|
| ✊ punho | Pedra |
| ✋ mão aberta | Papel |
| ✌️ indicador + médio | Tesoura |
| 👍 **joia** por 1 s | **Sair** (volta ao menu) |

O **placar** mostra vitórias, empates e derrotas, a sequência de vitórias e o recorde por nível (salvo no navegador).

> **Jogo justo:** o computador escolhe a jogada *antes* da contagem, usando só o histórico das rodadas anteriores. Ele nunca olha a sua mão da rodada atual. Contra um jogador realmente aleatório, nenhum nível tem vantagem.

Sem câmera? Use **Continuar sem câmera**: teclas `1`/`R` pedra, `2`/`P` papel, `3`/`T` tesoura, `Esc` sai.

## Deploy (Vercel)
Importe o repositório em [vercel.com/new](https://vercel.com/new) — sem configuração. O `package.json` tem um build mínimo e o `vercel.json` aponta `outputDirectory` para `public/`. O backend Python (`api/levels.py`) serve a configuração dos níveis em `/api/levels`; se estiver fora do ar o front usa os mesmos valores embutidos em `public/cpu.js`.

> Se o site der **404** logo após o deploy, abra *Project → Settings → Build and Deployment* e deixe *Framework Preset*, *Build Command*, *Install Command*, *Output Directory* e *Root Directory* **sem overrides**, depois faça *Redeploy*.

Rodar local: `python3 -m http.server -d public` (a câmera funciona em `localhost`).

## Testes
```bash
npm test      # regras, classificador de gestos e IA dos 3 níveis (Node, sem dependências)
```

## Estrutura
```
public/  index.html  style.css  app.js  gestures.js  cpu.js  engine.js
api/     levels.py          → função Python (Vercel)
tests/   rps.test.mjs
```
`engine.js` (cursor por apontar/pinçar) vem do projeto [HandMouse](https://github.com/RodrigoAiosa/HandMouse).
