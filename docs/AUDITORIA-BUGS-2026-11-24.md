# Conferência do relatório de bugs (24/11/2026)

Conferido lendo o código (calculadora regime regular 1.7.2 e o gateway). Nada disso foi executado contra as calculadoras rodando.

## Gateway (código deste repositório)

| Achado | Existe? | O que foi feito |
|---|---|---|
| Cache "LRU" é FIFO | Sim, mas sem efeito grave (limite de 500 entradas) | Virou LRU de verdade; parâmetros inválidos são corrigidos |
| Resposta sem limite de tamanho | Sim | Teto de 50 MB (cabeçalho e corpo) |
| Mapa do limite de taxa nunca limpo | Sim, mas é 1 entrada por conta | Limpeza das janelas antigas acima de 1000 entradas |
| Encerramento não espera requisições | Em grande parte não: `server.close()` já espera | Fecha conexões ociosas e sai à força após 15 s |
| Vazamento de cabeçalhos `X-*` | Não: só os serviços oficiais internos respondem e os `X-*` trazem a versão da base | Nada |
| Condição de corrida no cache | Não: Node executa em uma thread | Nada |
| Ordem do `ASAAS_URL` | Não: a variável explícita deve prevalecer | Nada |
| `AbortError` como "indisponível" | Não: `AbortSignal.timeout` gera `TimeoutError`, tratado | Nada |
| Sem pooling de conexões | Não: o `fetch` do Node já reaproveita conexões | Nada |

## Calculadoras da Receita (código de terceiros, fora deste repositório)

Ficam em `vendor/`, que é baixado pelo `setup` e não é versionado aqui. Não foram alteradas: o produto promete usar o código oficial sem modificação.

| Achado | Existe? |
|---|---|
| IMPORTANT-001 divisão por zero em diferimento de monofasia | Sim, em caso de borda (`tributoCalculado` zero) |
| IMPORTANT-004 caso "Alíquotas Combinadas" vazio | Sim, funcionalidade marcada "para fazer" pela própria Receita |
| IMPORTANT-002 arredondamento duplo da alíquota efetiva | Não: são grandezas diferentes, cada uma arredondada uma vez |
| IMPORTANT-006 condição de corrida nos mapas de variáveis | Não: cada cálculo cria seus mapas imutáveis (`Map.ofEntries`) |
| IMPORTANT-003, 005, 007, 008 e os demais | Não confirmados: dependem das expressões cadastradas na base e de execução |

Se quiser que a Receita corrija os dois confirmados, abra uma issue nos repositórios oficiais.
