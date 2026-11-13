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

3. **Jogue uma partida:** a tela conta *PEDRA… PAPEL… TESOURA… JÁ!* e você mostra a mão quando aparecer **JÁ!** As partidas são **melhor de 5**: vence quem fizer 3 rodadas (empates não contam).

| Gesto | Jogada |
|---|---|
| ✊ punho | Pedra |
| ✋ mão aberta | Papel |
| ✌️ indicador + médio | Tesoura |
| 👍 **joia** por 1 s | **Sair** (volta ao menu) |

O **placar** mostra vitórias, empates e derrotas da partida, a sequência de vitórias e o recorde por nível.

## Progressão
- **Estrelas por nível:** ⭐ vencer 3×2 · ⭐⭐ vencer 3×1 · ⭐⭐⭐ vencer 3×0. Fica a melhor de cada nível.
- **Desbloqueio:** o Aprendiz começa aberto; vencer uma partida abre o Jovem, e vencer no Jovem abre o Mestre. (Há um link *Destravar todos os níveis* no menu.)
- **XP e títulos:** cada rodada rende XP (níveis mais difíceis valem mais; vitórias seguidas dão bônus). Títulos: 🌱 Novato → 🥋 Praticante → ⚔️ Guerreiro → 🧘 Sensei → 🏯 Samurai.
- **11 conquistas** 🏆, como *Em chamas* (5 vitórias seguidas), *Virada* (vencer depois de perder por 0×2) e *Lenda* (vencer o Mestre por 3×0).
- No fim da partida, os botões também se escolhem **apontando e segurando**.

## ♾️ Modo Sobrevivência
Quanto mais você vence, mais difícil fica:
- **3 vidas** (❤️ a mais a cada 5 vitórias, no máximo 5). Perder uma rodada custa uma vida; empate não.
- **A contagem encurta** 40 ms a cada vitória (de 0,90 s até 0,38 s).
- **O computador evolui:** 0–2 vitórias joga aleatório · 3–6 conta as suas jogadas · 7+ lê padrões de sequência.
- O resultado é o número de vitórias, com recorde salvo. Conquistas *Sobrevivente* (10) e *Imparável* (20).

## 📤 Compartilhar o placar
Ao fim de uma partida ou sobrevivência, **Compartilhar** gera uma imagem 1200×630 com o resultado, as estrelas, seu título e o endereço do jogo. No celular abre a janela de compartilhar do sistema; no computador (ou ao escolher o botão com a mão) a imagem é baixada, pronta para postar.

Tudo fica salvo no navegador (`localStorage`); limpar os dados do site zera o progresso.

> **Jogo justo:** o computador escolhe a jogada *antes* da contagem, usando só o histórico das rodadas anteriores. Ele nunca olha a sua mão da rodada atual. Contra um jogador realmente aleatório, nenhum nível tem vantagem.

Sem câmera? Use **Continuar sem câmera**: teclas `1`/`R` pedra, `2`/`P` papel, `3`/`T` tesoura, `Esc` sai.

## Deploy (Vercel)
Importe o repositório em [vercel.com/new](https://vercel.com/new) — sem configuração. O `package.json` tem um build mínimo e o `vercel.json` aponta `outputDirectory` para `public/`. O backend Python (`api/levels.py`) serve a configuração dos níveis em `/api/levels`; se estiver fora do ar o front usa os mesmos valores embutidos em `public/cpu.js`.

> Se o site der **404** logo após o deploy, abra *Project → Settings → Build and Deployment* e deixe *Framework Preset*, *Build Command*, *Install Command*, *Output Directory* e *Root Directory* **sem overrides**, depois faça *Redeploy*.

Rodar local: `python3 -m http.server -d public` (a câmera funciona em `localhost`). Para depurar mais rápido, `?speed=0.2` na URL acelera todas as temporizações.

## Testes
```bash
npm test      # regras, gestos, IA dos 3 níveis, progressão e sobrevivência (Node, sem dependências)
```

## Estrutura
```
public/  index.html  style.css  app.js  gestures.js  cpu.js  progress.js  engine.js
api/     levels.py          → função Python (Vercel)
tests/   rps.test.mjs  progress.test.mjs
```
`engine.js` (cursor por apontar/pinçar) vem do projeto [HandMouse](https://github.com/RodrigoAiosa/HandMouse).
