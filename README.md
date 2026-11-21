# RTC SaaS

SaaS que unifica as três calculadoras oficiais da Receita Federal (licença MIT) atrás de uma única API autenticada e de uma interface web:

| Serviço oficial | Stack | Papel |
|---|---|---|
| `calculadora-rtc-regime-regular` | Java 25, Spring Boot 4, SQLite | CBS, IBS e IS; tabelas oficiais |
| `calculadora-rtc-simples-nacional` | Java 25, Spring Boot, SQLite | CBS e IBS para optantes do Simples |
| `calculadora-rtc-gerador-danfse` | Go | XML da NFS-e → DANFSe em PDF |

Os três serviços **não têm autenticação** (o Spring está com `permitAll`). Por isso só o gateway publica porta; os outros ficam na rede interna do compose. O código oficial não é modificado: `scripts/setup.sh` clona cada repositório em `vendor/`.

## O que o SaaS acrescenta

- Contas (multi-tenant), login e chaves de API (guardadas só como hash SHA-256, exibidas uma vez).
- Planos com cota mensal de cálculos e DANFSe (`gateway/src/plans.js`), limite de requisições por minuto.
- Histórico de uso por conta. **Corpo das requisições não é guardado** por padrão (dados fiscais); `STORE_PAYLOADS=true` guarda o JSON dos cálculos. O XML do DANFSe nunca é guardado.
- API única `/v1/*`, consultas às tabelas oficiais com cache, versões dos serviços.
- Interface web em `/` (calcular, gerar DANFSe, chaves, uso).

## Subir

```bash
./scripts/setup.sh          # clona os 3 repositórios e cria .env com segredos
docker compose up --build   # primeira vez demora: compila Java e gera o banco
# http://localhost:3000
```

O serviço `db-init` gera o banco SQLite com os scripts Flyway do regime regular e o compartilha (somente leitura) com os dois serviços Java.

Desenvolvimento do gateway (Node 22.13+, sem dependências): `cd gateway && npm test`.

## API

Autenticação: `Authorization: Bearer <sessão ou chave rtc_...>`.

| Método e rota | Encaminha para |
|---|---|
| `POST /auth/register`, `POST /auth/login` | — |
| `GET /me`, `GET /usage`, `GET /history` | — |
| `GET/POST /keys`, `DELETE /keys/:id` (só com login) | — |
| `POST /v1/calculo` `{ "regime": "regular"｜"simples", "operacao": {...} }` | regime regular `/observabilidade/regime-geral` ou Simples `/observabilidade/simples-nacional/nao-assistido` |
| `POST /v1/regime-regular/calculo` | `/observabilidade/regime-geral` |
| `POST /v1/simples-nacional/calculo` | `/observabilidade/simples-nacional/nao-assistido` |
| `POST /v1/simples-nacional/calculo-informado` | `/observabilidade/simples-nacional` (alíquotas por item) |
| `POST /v1/danfse?stc=0｜1｜2&canhoto=true｜false` (corpo XML) | `/api/danfse` |
| `GET /v1/simples-nacional/atividades[/{codigo}]` | atividades do Simples |
| `GET /v1/tabelas/{ncm｜nbs｜aliquota-uf｜…}` | `dados-abertos/*` (lista fechada) |
| `GET /v1/versao` | versões/estado dos três serviços |
| `PUT /admin/tenants/:id/plano` (`ADMIN_TOKEN`) | muda o plano da conta |

Os corpos de cálculo seguem o contrato oficial (veja `docs/exemplos.md` em cada repositório); o gateway repassa a resposta como veio, incluindo memória de cálculo e cabeçalhos de versão.

## Limitações conhecidas / a verificar

- **O compose não foi executado** (o ambiente de desenvolvimento não tinha rede para compilar os projetos Java 25 e Go). O gateway foi testado contra um serviço falso (6 testes); a integração real com os serviços da Receita precisa ser validada ao subir o compose pela primeira vez.
- O banco do Simples Nacional: assumi que ele usa o mesmo `calculadora-pro.db` gerado pelos scripts do regime regular (mesmo nome de arquivo e mesmos caminhos nos dois `application-offline.yml`). Se o Simples exigir scripts próprios, ajuste o `db-init`.
- Não há cobrança: os planos controlam cotas, mas pagamento (Stripe, Asaas, etc.) não foi integrado.
- SQLite no gateway serve para uma instância; para escalar horizontalmente troque por PostgreSQL.
- A Receita publica cada versão como release; fixe tags em `setup.sh` antes de produção, pois as regras tributárias mudam por versão.
- A calculadora não decide entre Simples e regime regular, e o uso fiscal continua sendo responsabilidade do contribuinte.
