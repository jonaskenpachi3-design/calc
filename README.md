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

Outras variáveis do gateway (valores padrão em `gateway/src/config.js`): `PORT`, `DB_PATH`, `SESSION_TTL_SECONDS`, `UPSTREAM_REGIME_REGULAR`, `UPSTREAM_SIMPLES_NACIONAL`, `UPSTREAM_DANFSE`, limites de tamanho, `MAX_OPERACOES_LOTE` (padrão 200 por chamada) e `RATE_LIMIT_PER_MINUTE`.

## Uso

Fluxo completo para o cliente:

1. Criar a conta (nome da empresa, e-mail, senha de 10 caracteres ou mais) e entrar. A primeira tela é a **Visão geral** (uso do mês e atividade recente).
2. **Simular tributos:** escolher “regime normal” ou “Simples Nacional”, preencher a operação e os itens, clicar em **Calcular tributos**.
3. **PDF da nota de serviço:** enviar o XML da NFS-e e baixar o DANFSe.
4. **Simulador em lote:** baixar a planilha modelo, preencher uma linha por item, enviar o CSV (até 500 operações) e ver totais, problemas por linha e o resultado para baixar. Em cada operação com problema há o botão **Corrigir**: abre os itens na própria tela (com busca pelo nome do produto), recalcula e permite baixar a planilha já corrigida.
5. **Busca por nome:** no formulário, o campo "Não sabe o código? Busque pelo nome" procura na lista oficial de NCM (produtos) ou NBS (serviços) vigente na data da operação. Se a classificação escolhida não se aplicar ao código, aparece um aviso (não bloqueia o cálculo).
5. **Minhas simulações:** consultar o histórico.
6. **Minha conta:** ver plano, uso do mês e (escondidas) chaves de API para integração.

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
- **Sem cobrança, sem recuperação de senha, sem confirmação de e-mail.**
- **SQLite:** serve para uma instância. Para escalar, troque por PostgreSQL.
- **Lote só por CSV**, sem XML, sem comparação com o modelo atual de tributos e sem relatório com a marca do escritório: veja o [roadmap](docs/PRODUTO-E-ROADMAP.md).

## Licença das calculadoras oficiais

Os três repositórios da Receita Federal usados em `vendor/` são licenciados sob MIT. Mantenha os avisos de licença ao redistribuí-los.
