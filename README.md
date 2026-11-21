# Simulador CBS e IBS (RTC SaaS)

Produto web para **quem não é de TI**: a pessoa preenche um formulário (data, local, itens, valores) e vê o valor de CBS e IBS item por item, em português simples, com opção de imprimir. Por baixo, usa as três calculadoras oficiais da Receita Federal (licença MIT):

| Serviço oficial | Stack | Papel |
|---|---|---|
| `calculadora-rtc-regime-regular` | Java 25, Spring Boot 4, SQLite | CBS, IBS e IS no regime normal; tabelas oficiais |
| `calculadora-rtc-simples-nacional` | Java 25, Spring Boot, SQLite | CBS e IBS para optantes do Simples |
| `calculadora-rtc-gerador-danfse` | Go | XML da NFS-e → DANFSe em PDF |

Os três serviços **não têm autenticação**. Só o gateway publica porta; os outros ficam na rede interna do compose. O código da Receita não é modificado: ele é baixado para `vendor/` (que não vai para o git).

## O que o cliente vê

- Página inicial com planos e login/cadastro.
- **Simular tributos:** escolhe "regime normal" ou "Simples Nacional", preenche a operação e os itens (listas de estados, municípios, classificações e atividades vêm das calculadoras oficiais) e recebe cards com o total, CBS, IBS, e uma linha por item com a situação e mensagens de erro em português.
- **PDF da nota de serviço:** envia o XML da NFS-e e baixa o DANFSe.
- **Minhas simulações** (histórico) e **Minha conta** (plano, uso do mês e, escondido, chaves de API para integração).

## Rodar

Requisitos: Docker (com o motor ligado), Git. Na pasta do projeto:

```bash
# Linux / macOS
./scripts/setup.sh
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

docker compose up --build     # a primeira vez demora 10–20 min (compila Java e Go)
# abra http://localhost:3000
```

O serviço `db-init` gera o banco SQLite com os scripts Flyway do regime regular; os dois serviços Java o leem em modo somente leitura. Testes do gateway (Node 22.13+, sem dependências): `cd gateway && npm test`.

## Configuração (`.env`)

| Variável | Para que serve |
|---|---|
| `AUTH_SECRET` | Assina as sessões (32+ caracteres). Obrigatória. |
| `ADMIN_TOKEN` | Autoriza trocar o plano de uma conta. Obrigatória. |
| `STORE_PAYLOADS` | `true` guarda o formulário preenchido no histórico. Padrão `false` (dados fiscais). |
| `ALIQUOTA_CBS`, `ALIQUOTA_IBS_ESTADUAL`, `ALIQUOTA_IBS_MUNICIPAL` | Alíquotas nominais (%) que a calculadora exige a partir de 2027. Padrão 8,8 / 0,05 / 0,05 (valores do exemplo oficial de teste). |

Trocar o plano de uma conta: `PUT /admin/tenants/{id}/plano` com `Authorization: Bearer <ADMIN_TOKEN>` e corpo `{"plano":"profissional"}`. Os limites estão em `gateway/src/plans.js`.

## API para integrações

Autenticação: `Authorization: Bearer <sessão ou chave rtc_...>`.

| Rota | O que faz |
|---|---|
| `POST /v1/simulacoes/regime-normal` | Formulário simplificado → resultado legível |
| `POST /v1/simulacoes/simples-nacional` | Idem, Simples Nacional |
| `POST /v1/regime-regular/calculo`, `/v1/simples-nacional/calculo[-informado]`, `/v1/calculo` | Contrato oficial, repassado como veio |
| `POST /v1/danfse?stc=0｜1｜2&canhoto=true｜false` (corpo XML) | PDF da nota |
| `GET /v1/dados/{ufs, ufs/municipios, classificacoes-tributarias/cbs-ibs, ncm, nbs, ...}` | Tabelas oficiais (cache de 5 min; a maioria exige `?data=AAAA-MM-DD`) |
| `GET /v1/simples-nacional/atividades?data=...&tpDoc=...` | Atividades do Simples |
| `GET /v1/versao` | Versões dos serviços |
| `GET /planos` (pública), `GET /me`, `/usage`, `/history`, `GET/POST/DELETE /keys` | Conta |

## Limitações conhecidas (leia antes de vender)

- **Validação com as calculadoras reais:** o gateway e a tela foram testados com calculadoras *falsas* que respondem no formato documentado pela Receita. A integração real foi confirmada só até a subida dos contêineres; falta rodar simulações de verdade e ajustar o que a Receita rejeitar.
- **Alíquotas de referência:** os valores padrão são os do exemplo de teste da Receita, não a legislação final. Confirme-os antes de mostrar a clientes, e deixe claro o caráter informativo (já consta na tela).
- **Código do produto/serviço:** o cliente precisa saber o NCM (8 dígitos) ou NBS (9 dígitos) e escolher a classificação tributária. Não há ainda busca por nome do produto; é a melhoria de maior impacto para um público leigo.
- **Simples Nacional:** a calculadora oficial exige as alíquotas efetivas (extrato do PGDAS-D). A tela pede esses valores; não os calcula. O cálculo de tributos fora do Simples (ISS retido, benefícios municipais) usa padrões (`tribISSQN=1`, `tpRetISSQN=1`).
- **Imposto Seletivo e compra governamental** não estão no formulário (a API oficial os suporta).
- **Sem cobrança:** os planos só controlam cotas; falta integrar pagamento (Stripe, Asaas etc.), recuperação de senha e confirmação de e-mail.
- **SQLite** no gateway serve para uma instância; para escalar, troque por PostgreSQL.
- **Versões:** fixe tags dos repositórios oficiais em `scripts/setup.*` antes de produção; as regras mudam por versão.
