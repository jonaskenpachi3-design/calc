# Simulador CBS e IBS

Aplicação web para simular a **CBS** e o **IBS** (tributos da Reforma Tributária do consumo) sem precisar entender de sistemas. A pessoa preenche um formulário (data, local, itens e valores) e vê o resultado item por item, em português simples, com opção de imprimir. O cálculo é feito pelas **calculadoras oficiais da Receita Federal** (licença MIT), que o produto junta em um único serviço com login, planos e histórico.

> **Aviso:** o resultado é informativo. Não substitui a apuração oficial nem o contador.

Documentos relacionados: [Produto e roadmap](docs/PRODUTO-E-ROADMAP.md) (o que existe, o que é parcial e o que é plano).

## Sumário

1. [Para que serve e para quem](#para-que-serve-e-para-quem)
2. [Como funciona](#como-funciona)
3. [Requisitos](#requisitos)
4. [Instalação](#instalação)
5. [Configuração](#configuração)
6. [Uso](#uso)
7. [Planos e cotas](#planos-e-cotas)
8. [API](#api)
9. [Testes](#testes)
10. [Operação e atualização](#operação-e-atualização)
11. [Segurança e privacidade](#segurança-e-privacidade)
12. [Estrutura do repositório](#estrutura-do-repositório)
13. [Limitações conhecidas](#limitações-conhecidas)

## Para que serve e para quem

A Receita publicou três calculadoras abertas, feitas para desenvolvedores: recebem JSON, não têm login e não têm tela. Este projeto as transforma em produto para **empresas e escritórios de contabilidade**, que não são da área de TI:

- veem quanto de CBS e IBS incide em uma venda ou serviço;
- escolhem o regime (normal ou Simples Nacional) em vez de montar JSON;
- recebem mensagens de erro em português;
- guardam o histórico e geram o PDF da nota de serviço.

## Como funciona

```text
Navegador (formulário)
        |
        v
 +--------------------+      rede interna do Docker (sem portas publicadas)
 |      Gateway       |      +---------------------------------------+
 |  Node 22, porta    |----->| regime-regular   (Java, CBS/IBS/IS)    |
 |  3000              |----->| simples-nacional (Java)                |
 |  login, planos,    |----->| danfse           (Go, XML -> PDF)      |
 |  cota, histórico   |      +---------------------------------------+
 +--------------------+
        |
     SQLite (contas, chaves, uso)
```

- **Só o gateway publica porta.** Os três serviços oficiais não têm autenticação e ficam na rede interna.
- O gateway valida a conta, confere a cota do plano, traduz o formulário simples para o contrato oficial, chama a calculadora e traduz a resposta para português.
- O serviço `db-init` gera o banco SQLite com as migrações Flyway do regime regular. Os dois serviços Java o leem em modo somente leitura (volume `calc-db`).
- O código da Receita não é modificado: é baixado para `vendor/`, que não vai para o git.

| Serviço oficial | Tecnologia | Papel |
|---|---|---|
| `calculadora-rtc-regime-regular` | Java 25, Spring Boot, SQLite | CBS, IBS e IS no regime normal; tabelas oficiais |
| `calculadora-rtc-simples-nacional` | Java 25, Spring Boot, SQLite | CBS e IBS para optantes do Simples Nacional |
| `calculadora-rtc-gerador-danfse` | Go | XML da NFS-e para DANFSe em PDF |

O gateway não tem dependências externas: usa só o Node 22.13+ (`node:http`, `node:sqlite`, `node:crypto`).

## Requisitos

- Docker com o motor ligado (no Windows, abra o Docker Desktop e espere “Engine running”). Recomendado: 4 GiB de memória ou mais para o Docker.
- Git.
- Internet na primeira instalação (baixa os repositórios e as imagens).
- Para rodar só os testes do gateway: Node 22.13 ou superior.

## Instalação

Na pasta do projeto.

**Linux ou macOS**

```bash
./scripts/setup.sh
docker compose up --build
```

**Windows (PowerShell)**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
docker compose up --build
```

O script de preparação baixa os três repositórios oficiais em `vendor/`, **nas versões fixadas em `versoes.txt`**, e cria o arquivo `.env` com segredos aleatórios. A primeira subida leva de 10 a 20 minutos (compila Java e Go). Depois, abra <http://localhost:3000>.

Para parar sem perder dados: `docker compose down`.

> **Nunca use `docker compose down -v`.** O `-v` apaga os volumes, incluindo as contas e o histórico (`saas-data`).

Se der erro de arquivos com quebra de linha do Windows (`mvnw: not found`), o repositório já traz `.gitattributes` para evitar isso; clone de novo com `git config core.autocrlf false` se necessário.

## Configuração

Variáveis no arquivo `.env` (nunca vai para o git):

| Variável | Para que serve |
|---|---|
| `AUTH_SECRET` | Assina as sessões. 32 caracteres ou mais. Obrigatória. |
| `ADMIN_TOKEN` | Autoriza trocar o plano de uma conta. Obrigatória. |
| `STORE_PAYLOADS` | `true` guarda o formulário preenchido no histórico. Padrão `false`, por serem dados fiscais. |
| `ALIQUOTA_CBS`, `ALIQUOTA_IBS_ESTADUAL`, `ALIQUOTA_IBS_MUNICIPAL` | Alíquotas nominais (%) exigidas pela calculadora para datas a partir de 2027. Padrão 8,8 / 0,05 / 0,05 (valores do exemplo de teste da Receita). **Confirme antes de mostrar a clientes.** |

**E-mail.** O gateway envia e-mail por SMTP (sem biblioteca: TLS direto, STARTTLS e login), usado na recuperação de senha, na confirmação de e-mail e no envio de DANFSe ao cliente. Use o SMTP do seu provedor (Gmail com senha de app, Amazon SES, Brevo, Locaweb etc.). Só envia a senha do SMTP por conexão criptografada.

| Variável | Para que serve |
|---|---|
| `SMTP_HOST` | Servidor SMTP. **Vazio = e-mail desligado.** |
| `SMTP_PORT` | Porta. Padrão 587 (STARTTLS) ou 465 com `SMTP_SECURE=true`. |
| `SMTP_SECURE` | `true` para TLS direto (porta 465). |
| `SMTP_USER`, `SMTP_PASS` | Login do SMTP. |
| `SMTP_FROM` | Remetente, ex.: `Nexo Fiscal <contato@seudominio.com.br>`. Use um endereço do seu domínio, com SPF/DKIM configurados no provedor, para não cair no spam. |
| `APP_NAME` | Nome nos e-mails. Padrão `Nexo Fiscal`. |
| `EMAILS_POR_DIA` | Limite de DANFSe enviados por e-mail, por conta. Padrão 100. |

Teste rápido: cadastre uma conta nova com um e-mail seu e veja se chega o link de confirmação. Se não chegar, o motivo aparece no log do contêiner do gateway (`docker compose logs gateway`).

Sem SMTP, os links podem sair por webhook ou ser gerados pelo operador, como abaixo.

**Recuperação de senha.** Ao pedir "Esqueci minha senha", ele cria um link de uso único, válido por 1 hora, e o entrega de um destes jeitos:

| Variável | Para que serve |
|---|---|
| `PUBLIC_URL` | Endereço público do sistema, usado para montar o link (ex.: `https://app.seudominio.com.br`). |
| `RESET_WEBHOOK_URL` | Opcional. O gateway faz um POST JSON `{tipo, email, link, expira_em}` neste endereço (Zapier, n8n, sua função de e-mail). |
| `RESET_WEBHOOK_TOKEN` | Opcional. Enviado como `Authorization: Bearer`. |
| `RESET_TTL_SECONDS` | Validade do link. Padrão 3600. |

**Confirmação de e-mail.** Quem se cadastra recebe um link de confirmação (uso único, 24 h) pelo mesmo webhook, com `tipo: "confirmacao_de_email"` (o da senha vem como `"redefinicao_de_senha"`). Por padrão, a pessoa só vê um aviso com o botão "Reenviar link" e usa o sistema normalmente. Com `EXIGIR_CONFIRMACAO_EMAIL=true`, nada funciona até confirmar. Contas criadas antes desta função contam como confirmadas, e redefinir a senha pelo link do e-mail também confirma. Sem webhook, o operador confirma direto (`POST /admin/usuarios/confirmacao` com `{"email":"...","confirmar":true}`) ou gera o link (sem `confirmar`).

| Variável | Para que serve |
|---|---|
| `EXIGIR_CONFIRMACAO_EMAIL` | `true` bloqueia o uso até confirmar o e-mail. Padrão `false`. |
| `CONFIRM_TTL_SECONDS` | Validade do link de confirmação. Padrão 86400. |

Sem webhook, o operador gera o link e o repassa ao cliente: `curl -X POST $URL/admin/usuarios/redefinicao -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"email":"cliente@x.com"}'`. O sistema responde igual exista ou não o e-mail, aceita 3 pedidos por hora por conta, guarda só o hash do link, e a troca encerra as sessões antigas.

**Cobrança (Asaas).** Com `ASAAS_API_KEY`, a tela Configurações passa a vender os planos Profissional e Ilimitado por assinatura mensal (o cliente escolhe Pix, boleto ou cartão na fatura do Asaas; o sistema não guarda dados de cartão). O plano só muda quando o Asaas confirma o pagamento; se o período pago vence e não há renovação, a conta volta ao Gratuito depois de alguns dias de tolerância.

1. Crie a conta no Asaas e gere a chave de API (use primeiro a chave do **sandbox**, que começa com `$aact_hmlg_`; o sistema detecta sozinho).
2. No Asaas, em Integrações → Webhooks, cadastre a URL `https://SEU-DOMINIO/webhooks/asaas`, defina um **token de autenticação** (32+ caracteres) e marque os eventos de **cobranças** e de **assinaturas**.
3. Coloque no `.env`: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` (o mesmo token) e `PUBLIC_URL`.
4. Teste no sandbox: assine, pague a fatura de teste e veja o plano mudar. Só depois troque pela chave de produção (`$aact_prod_`).

| Variável | Para que serve |
|---|---|
| `ASAAS_API_KEY` | Chave da API. Vazio = cobrança desligada (o plano é trocado pelo operador). |
| `ASAAS_WEBHOOK_TOKEN` | Token que o Asaas envia no webhook. Sem ele, o webhook recusa tudo. |
| `PRECO_PROFISSIONAL`, `PRECO_ILIMITADO` | Preço mensal em reais. Padrão 149 e 399 (**valores provisórios**). Os limites de cada plano ficam em `gateway/src/plans.js`. |
| `CARENCIA_DIAS` | Dias de tolerância depois do fim do período pago. Padrão 5. |

> **Não testado contra o Asaas de verdade.** A integração segue a documentação do Asaas e foi testada com um servidor Asaas simulado. Faça a primeira rodada completa no sandbox antes de cobrar clientes. Confira também com o Asaas e com seu contador a emissão de nota fiscal das mensalidades.

Outras variáveis do gateway (valores padrão em `gateway/src/config.js`): `PORT`, `DB_PATH`, `SESSION_TTL_SECONDS`, `UPSTREAM_REGIME_REGULAR`, `UPSTREAM_SIMPLES_NACIONAL`, `UPSTREAM_DANFSE`, limites de tamanho, `MAX_OPERACOES_LOTE` (padrão 200 por chamada) e `RATE_LIMIT_PER_MINUTE`.

## Uso

Fluxo completo para o cliente:

1. Criar a conta (nome do escritório, e-mail, senha de 10 caracteres ou mais) e entrar. Em seguida vem a **Carteira de CNPJs**: cadastre cada cliente (CNPJ, razão social, regime) e clique em *Acessar painel*. O plano limita quantos CNPJs podem ficar cadastrados (gratuito 2, profissional 15, valores de partida).
2. **Visão geral:** faturamento analisado, carga atual (tributos informados nas notas), projeção de CBS + IBS, diferença e gráfico por mês. Os números vêm das análises que você salvou (só totais; notas e itens nunca são guardados). Sem análises, a tela diz isso em vez de mostrar números.
3. **Simular tributos:** uma operação por vez, regime normal ou Simples Nacional, com busca de NCM/NBS por nome e aviso de classificação incompatível. Cada cálculo salva os totais na Visão geral.
4. **Simulador em lote:** arraste XML (NF-e, NFC-e, NFS-e), ZIP de XMLs ou a planilha CSV (até 500 operações). Opção de também simular o Simples Nacional para comparar. Mostra progresso e leva à Auditoria.
5. **Auditoria:** filtros Todos / Com erro / Validados, correção na própria tela (código com busca por nome, classificação, valor, atividade), recálculo de uma nota ou de todas as corrigidas (o comparativo com o Simples Nacional é refeito junto), planilha corrigida e resultado em CSV. Botão *Salvar na Visão geral* (salvar de novo substitui os totais anteriores do lote).
6. **Relatório:** abas Resumo executivo e Memória de cálculo, painel com logotipo e parecer do contador, PDF pela impressão do navegador, Excel (.xlsx, com abas Resumo e Operações) e CSV. Nome, responsável, CRC, contato e cor do escritório ficam salvos na conta.
7. **Central DANFSe:** XML(s) ou ZIP de NFS-e para PDFs, com canhoto opcional, ZIP de PDFs, envio do PDF por e-mail ao cliente (com SMTP configurado; o PDF não fica guardado) e histórico recente (só data, resultado e tempo).
8. **Configurações:** uso do plano (CNPJs, simulações e PDFs do mês), dados do escritório e chaves de API para integração. Com o Asaas configurado, mostra os planos com preço e leva ao pagamento (assinar, pagar a fatura, cancelar); sem ele, *Aumentar limite* abre um e-mail para o comercial.

A tela segue o protótipo "Nexo Fiscal": menu lateral, painel de visão geral com o uso real da conta, cartões e formulários guiados. As funções do protótipo que ainda não existem (carteira de CNPJs, auditoria completa, comparativo) aparecem no menu como "Em breve", sem dados de mentira. Para trocar o nome da marca, edite `gateway/public/index.html` (busque por "nexo fiscal").

O passo a passo para o usuário final está no manual do usuário, entregue junto com este projeto.

## Planos e cotas

| Plano | Simulações por mês | PDFs por mês |
|---|---|---|
| gratuito | 500 | 50 |
| profissional | 20.000 | 2.000 |
| ilimitado | sem limite | sem limite |

Os limites ficam em `gateway/src/plans.js`. Para trocar o plano de uma conta:

```bash
curl -X PUT http://localhost:3000/admin/tenants/ID_DA_CONTA/plano \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plano":"profissional"}'
```

Os planos só controlam cota. **Não há cobrança integrada** (veja as limitações).

## API

Autenticação: `Authorization: Bearer <token de sessão ou chave rtc_...>`. As chaves são criadas em **Minha conta** e guardadas só como hash.

| Rota | O que faz |
|---|---|
| `POST /v1/simulacoes/regime-normal` | Formulário simplificado, resultado legível |
| `POST /v1/simulacoes/simples-nacional` | Idem, Simples Nacional |
| `POST /v1/regime-regular/calculo`, `/v1/simples-nacional/calculo[-informado]`, `/v1/calculo` | Contrato oficial, repassado como veio |
| `POST /v1/simulacoes/lote` | Várias simulações de uma vez (`regime` e `operacoes`, até 200 por chamada; cada operação gasta uma unidade da cota) |
| `POST /v1/danfse?stc=0\|1\|2&canhoto=true\|false` (corpo XML) | PDF da nota |
| `GET /v1/dados/...`, `/v1/tabelas/...` | Tabelas oficiais (UFs, municípios, NCM, NBS, classificações, alíquotas). Cache de 5 minutos; a maioria exige `?data=AAAA-MM-DD` |
| `GET /v1/simples-nacional/atividades?data=...&tpDoc=...` | Atividades do Simples |
| `GET /v1/versao` | Versão do serviço de regime regular |
| `GET /planos` (pública), `GET /me`, `/usage`, `/history`, `GET/POST/DELETE /keys` | Conta |
| `POST /auth/register`, `POST /auth/login` | Cadastro e login |
| `GET /health` | Verificação de saúde |

Códigos úteis: 401 (sem login), 429 (limite por minuto ou cota do plano), 400 (dados inválidos, com mensagem em português).

## Testes

```bash
cd gateway
npm test      # 21 testes, sem dependências
```

Os testes usam calculadoras falsas que respondem no formato documentado pela Receita. **Eles não substituem a validação com as calculadoras reais.**

## Operação e atualização

- **Logs:** `docker compose logs -f gateway` (ou o nome de outro serviço).
- **Backup:** copie o volume `saas-data` (contas, chaves, uso e histórico).
- **Atualizar o sistema:** `git pull` e depois `docker compose up --build`.
- **Versões das calculadoras da Receita:** ficam fixadas por commit em `versoes.txt`, então todo mundo roda a mesma versão. Para saber se saiu versão nova, rode `./scripts/verificar-atualizacoes.sh` (ou `scripts\verificar-atualizacoes.ps1` no Windows); ele só consulta, não altera nada. Para atualizar: troque o commit em `versoes.txt`, rode o script de preparação, `docker compose up --build`, teste as simulações e só então publique. As regras tributárias mudam entre versões.
- **Memória:** cada serviço tem teto no `docker-compose.yml`: 1 GiB por serviço Java (heap de 512 MiB), 192 MiB para o DANFSe e 256 MiB para o gateway, cerca de 2,5 GiB no total. Ajuste pelo `.env` com `MEM_JAVA`, `JAVA_XMX`, `MEM_DANFSE` e `MEM_GATEWAY`. No Docker Desktop, dê ao menos 4 GiB ao Docker. Se um serviço estourar a memória, ele reinicia sozinho sem derrubar os outros.

## Segurança e privacidade

- Senhas com scrypt; sessões assinadas com HMAC-SHA256; chaves de API guardadas como hash SHA-256.
- Limite de requisições por minuto e cota mensal por plano.
- O que a pessoa preencheu **não é guardado** por padrão (`STORE_PAYLOADS=false`). O XML e o PDF do DANFSe nunca são guardados.
- O telas montam o HTML sem inserir dados do usuário como código.
- **Não envie `.env` nem `vendor/` ao git.** O `.gitignore` já os ignora, assim como `gateway/data/` e `node_modules/`.
- Como o produto é vendido, mantenha este repositório **privado**.
- Em produção, ponha o gateway atrás de HTTPS (proxy reverso).

## Estrutura do repositório

```text
gateway/            Gateway em Node (API, login, planos, tela)
  src/              código (app, auth, db, planos, simulação, upstream)
  public/index.html tela do cliente
  test/             testes
docker/             Dockerfile dos serviços Java
docker-compose.yml  sobe tudo
scripts/            preparação (setup.sh e setup.ps1)
docs/               produto e roadmap
```

## Limitações conhecidas

Leia antes de vender.

- **Validação com as calculadoras reais:** os contratos (campos enviados e lidos, nos dois regimes, nas tabelas e no DANFSe) foram conferidos contra o código-fonte oficial e os testes passam com calculadoras simuladas. Falta rodar simulações reais de ponta a ponta e ajustar o que a Receita rejeitar. Itens de classificação que exigem quantidade (monofasia) e o Imposto Seletivo ainda não têm campo no formulário.
- **Alíquotas de referência:** os padrões são os do exemplo de teste, não a legislação final.
- **Código do produto ou serviço:** o cliente pode buscar pelo nome, mas a busca é por palavras na descrição oficial (não há sinônimos nem nome comercial). O aviso de classificação incompatível depende da resposta da calculadora oficial e ainda não foi testado contra ela.
- **Simples Nacional:** a alíquota efetiva é informada pelo usuário (extrato do PGDAS-D); o sistema não a calcula. ISS retido e benefícios municipais usam padrões.
- **Imposto Seletivo e compra governamental** não estão no formulário.
- **Cobrança e e-mail dependem de contas suas** (Asaas e um SMTP); sem elas ficam desligados. A cobrança não foi testada contra o Asaas real.
- **SQLite:** serve para uma instância. Para escalar, troque por PostgreSQL.
- **XML no lote** só vale para o regime normal, e notas antigas sem o grupo de CBS e IBS vêm sem classificação tributária (completa-se na tela). Os layouts foram conferidos com os XMLs de exemplo da Receita, não com notas reais de clientes.
- **Modelo atual (ICMS, ISS, PIS, COFINS):** nenhuma calculadora da Receita o calcula. O comparativo usa os valores informados na nota ou na planilha, é bruto (sem créditos) e, nas NFS-e, só conhece o ISS. Emitentes do Simples ficam fora (o DAS é único).
- **Comparativo Simples × regular** soma só CBS e IBS: não inclui o restante do DAS nem os créditos do regime regular.
- **Relatório em PDF** vem da impressão do navegador (sem servidor de PDF); o Excel é um .xlsx gerado no navegador. Não há gráficos além de barras simples. O resultado detalhado do lote não vai para o servidor: fica guardado no navegador deste computador (por empresa, até 7 dias) e é apagado ao clicar em Sair, em Limpar/Novo lote, ou se o navegador bloquear o armazenamento local (aí fica só na memória e some ao fechar a página). Em computador compartilhado, use sempre Sair.
- **Cenário Simples no lote** usa as mesmas alíquotas efetivas e atividade para todas as notas; ao corrigir uma nota na Auditoria ele é recalculado com esses mesmos parâmetros.
- **Visão geral:** a carga atual só considera operações com tributos atuais informados; a porcentagem usa a base de todas as análises e pode ficar subestimada se parte delas não tiver esse dado.
- **Avulso do DANFSe** (preencher dados sem XML) não existe: o gerador oficial só aceita o XML.
- **Consulta de CNPJ** no cadastro de empresas usa APIs públicas chamadas direto pelo navegador.

## Colocando no ar: checklist

1. `cp .env.example .env` e preencha `AUTH_SECRET`, `ADMIN_TOKEN` e `PUBLIC_URL`.
2. **E-mail**: preencha `SMTP_*` e teste com `node --env-file=.env scripts/testar-email.mjs seu@email.com`.
3. **Cobrança**: crie a conta no sandbox do Asaas, ponha a chave em `ASAAS_API_KEY` e um `ASAAS_WEBHOOK_TOKEN` seu, e teste com `node --env-file=.env scripts/testar-asaas.mjs` (recusa chave de produção sem `--producao`). Cadastre o webhook `PUBLIC_URL/webhooks/asaas` no painel do Asaas com o mesmo token, pague a fatura de teste e confira que o plano mudou.
4. **Calculadoras reais**: rode `scripts/verificar-integracao.mjs` (seção abaixo).
5. Defina `PRECO_*` e os limites em `plans.js`, e confirme as `ALIQUOTA_*`.

## Verificação com as calculadoras oficiais

Os testes automáticos (`npm test`) usam calculadoras falsas. Antes de vender, rode o roteiro que usa as reais:

```sh
./scripts/setup.sh && docker compose up --build -d      # na raiz do projeto
ADMIN_TOKEN=$(grep ADMIN_TOKEN .env | cut -d= -f2) node scripts/verificar-integracao.mjs
```

O script cria uma conta descartável, confere o formato de cada resposta real (tabelas, regime normal, Simples com uma conta conhecida, lote, DANFSe), roda uma carga e mede a memória de cada contêiner (pico, limite, reinícios, morte por falta de memória), sugerindo valores de `MEM_JAVA` e `JAVA_XMX`. Grava `integracao-resultado.json` com tudo; se algo falhar, envie esse arquivo. Opções: `--url`, `--xml nota.xml` (NFS-e autorizada para o DANFSe), `--total`, `--conc`. Sem `ADMIN_TOKEN`, a conta fica no plano gratuito e a carga estoura a cota.

Ele ainda não foi executado contra as calculadoras reais (o ambiente de desenvolvimento não compila as imagens oficiais). Foi validado só contra as falsas. Os valores de memória do `docker-compose.yml` continuam sendo estimativas até esse roteiro rodar.

## Licença das calculadoras oficiais

Os três repositórios da Receita Federal usados em `vendor/` são licenciados sob MIT. Mantenha os avisos de licença ao redistribuí-los.
