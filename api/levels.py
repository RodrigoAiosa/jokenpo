"""GET /api/levels — configuração dos níveis servida pelo backend Python (Vercel).

O front-end busca isto ao iniciar; se a API estiver fora do ar usa os mesmos
valores embutidos em public/cpu.js. Para balancear a dificuldade, edite LEVELS
e faça um novo deploy.

  beat      duração de cada tempo da contagem (ms) — quanto menor, mais difícil
  strategy  random | freq (frequência das suas jogadas) | markov (padrões de sequência)
  p         chance de o computador usar a previsão em vez de jogar aleatório
"""
import json
from http.server import BaseHTTPRequestHandler

LEVELS = {
    "aprendiz": {"name": "Aprendiz", "icon": "🌱", "beat": 900, "strategy": "random", "p": 0.0},
    "jovem": {"name": "Jovem", "icon": "⚔️", "beat": 700, "strategy": "freq", "p": 0.5},
    "mestre": {"name": "Mestre", "icon": "🐉", "beat": 550, "strategy": "markov", "p": 0.85},
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(LEVELS, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600")
        self.end_headers()
        self.wfile.write(body)
