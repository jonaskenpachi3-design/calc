# Documento de Implementação — 7 Telas Nexo Fiscal

**Versão:** 2.0 (reescrita para refletir o código real)
**Data:** 2026-11-22
**Projeto:** calc (gateway + calculadoras oficiais da Receita Federal)

> Este documento descreve **o que existe no código hoje**. Onde algo foi planejado e não foi feito, ou foi feito de outro jeito, isso está dito. A versão 1.0 (planejamento) previa Express, Redis/Bull, Puppeteer e ExcelJS; nada disso foi usado, de propósito.

---

## 1. Visão geral

### 1.1 Princípios do que foi construído

- **Gateway Node puro, sem dependências npm** (Node 22.13+): `node:http`, `node:sqlite`, scrypt, HMAC. Menos superfície de ataque e nada a instalar.
- **Front-end em módulos ES**, sem etapa de build, rota por hash (`#/aba`).
- **Nada de dado inventado.** Cada tela mostra o que veio do servidor ou do arquivo enviado. Sem análise salva, a tela fica vazia e diz isso.
- **Privacidade:** o servidor guarda só **totais** de cada análise. O resultado detalhado do lote **não vai ao servidor**: fica guardado só no navegador do usuário (IndexedDB). XML e PDF do DANFSe nunca são guardados.
- **Todo texto vindo do servidor ou de arquivo** entra na tela por `textContent` ou `esc()`, nunca como HTML cru.

### 1.2 Status das 7 telas

| # | Tela | Status | Arquivos |
|---|------|--------|----------|
| 1 | Acesso (login, cadastro, recuperação de senha, confirmação de e-mail) | ✅ Feita | `LoginScreen.js` |
| 2 | Carteira de CNPJs | ✅ Feita | `CompanySelector.js` |
| 3 | Visão geral | ✅ Feita (números reais) | `Dashboard.js` |
| 4 | Simulador em lote | ✅ Feita, com limites (ver 3.4) | `LoteSimulador.js`, `lote-engine.js`, `lote-store.js`, `lote-salvar.js`, `zip.js` |
| 5 | Auditoria | ✅ Feita, com limites (ver 3.5) | `Auditoria.js`, `catalogo.js` |
| 6 | Relatório white-label | ✅ Feito, com limites (ver 3.6) | `Relatorio.js`, `relatorio-doc.js`, `analise.js` |
| 7 | Central DANFSe + Configurações | ✅ Feitas, com limites (ver 3.7) | `DanfseCentral.js`, `Configuracoes.js`, `escritorio.js` |

Além das 7: `Simulador.js` (cálculo item a item, com comparativo Simples × regime normal).

> **Importante:** tudo foi testado com calculadoras **simuladas** (servidores falsos que imitam o formato esperado). As calculadoras oficiais (Java 8080, Java 8082, Go) **não foram executadas contra o front-end**. Rode `scripts/verificar-integracao.mjs` (ver seção 7).

---

## 2. Arquitetura

### 2.1 Front-end (`gateway/public/`)

```
index.html · styles.css · app.js · router.js · state.js · api.js · utils.js
analise.js · catalogo.js · escritorio.js · lote-engine.js · lote-salvar.js
lote-store.js · relatorio-doc.js · zip.js
components/ Auditoria · CompanySelector · Configuracoes · DanfseCentral
            Dashboard · LoginScreen · LoteSimulador · Relatorio · Simulador
```

- Token de sessão em `sessionStorage` (`rtc_token`); empresa ativa em `state.js`.
- Sem Chart.js: o gráfico da Visão geral é feito com barras em CSS.
- Política de segurança de conteúdo (CSP) bloqueia imagens `blob:`; a logo é lida como data URL.

### 2.2 Gateway (`gateway/src/`)

```
index.js  app.js  auth.js  config.js  db.js  plans.js  simulacao.js  upstream.js
```

Um único `app.js` concentra as rotas. Banco: SQLite (`node:sqlite`). Testes: `test/gateway.test.js` e `test/simulacao.test.js` (27 testes passando em `npm test`).

### 2.3 Calculadoras (por trás do gateway)

Regime regular (Java, 8080), Simples Nacional (Java, 8082) e DANFSe (Go), em contêineres com versões fixas e memória limitada.

### 2.4 Processamento do lote: como é de fato

A v1.0 previa worker + Redis. **Não foi feito.** O lote funciona assim:

1. O **navegador** lê CSV, XML (NF-e, NFC-e, NFS-e) e ZIP, com limites de tamanho.
2. Divide em blocos de **50 operações** e envia cada bloco a `POST /v1/simulacoes/lote` (o servidor aceita até `MAX_OPERACOES_LOTE`, padrão 200).
3. O resultado é montado no navegador e mantido em `lote-store.js` (memória), com uma **cópia no IndexedDB** deste computador, por escritório e empresa (`persistirLote` / `restaurarLote`).
4. Só os **totais** vão ao banco, quando a pessoa salva a análise.

Consequência: fechar a aba **não** perde mais o lote nem as correções da Auditoria; ao entrar de novo e escolher a empresa, ele volta (aviso na tela). A cópia vale 7 dias e é apagada em **Sair**, em **Limpar/Novo lote** e ao iniciar outro lote. Se o navegador bloquear o armazenamento (modo privado, cota), o lote segue só na memória. Em computador compartilhado, é preciso usar Sair.

---

## 3. Detalhamento por tela

### 3.1 Acesso
- Entrar e criar conta (senha de 10 a 200 caracteres).
- **Recuperação de senha:** "Esqueci minha senha" → link de uso único, válido por 1 hora, guardado só como hash. Entrega por webhook (`RESET_WEBHOOK_URL`) ou gerado pelo operador (`POST /admin/usuarios/redefinicao`). Resposta idêntica exista ou não o e-mail; 3 pedidos por hora por conta; a troca encerra as sessões antigas.
- **Não há envio de e-mail embutido** (sem SMTP).
- **Confirmação de e-mail:** o cadastro dispara um link de uso único (24 h) pelo mesmo webhook (`tipo: confirmacao_de_email`). Padrão: aviso com "Reenviar link" (3 por hora). Com `EXIGIR_CONFIRMACAO_EMAIL=true`, o sistema fica bloqueado até confirmar (erro 403 `email_nao_confirmado`, tela "Confirme seu e-mail"). Contas antigas contam como confirmadas; redefinir a senha pelo link também confirma. O operador pode confirmar direto ou gerar o link (`POST /admin/usuarios/confirmacao`).

### 3.2 Carteira de CNPJs
- Cadastrar, escolher, trocar e excluir empresas; isoladas por escritório (chave composta `tenant_id + cnpj`).
- Limite por plano (erro 403 `limite_empresas`).
- Preenchimento por CNPJ chama **APIs públicas diretamente do navegador** (podem falhar ou ter limite de uso).

### 3.3 Visão geral
- `GET /empresas/:cnpj/dashboard` agrega as análises salvas dos últimos 6 meses: faturamento analisado, carga atual (tributos informados nos XML/CSV), projeção CBS + IBS, diferença (bruta, sem créditos), alertas, uso do plano.
- Gráfico de 3 séries: tributos atuais, CBS+IBS (regime normal), CBS+IBS (Simples).
- Sem análise salva: tela vazia com aviso.
- ⚠️ A "carga atual" pode ficar subestimada quando os arquivos trazem tributos incompletos.

### 3.4 Simulador em lote
- Entrada: CSV, XML (NF-e/NFC-e/NFS-e) e ZIP.
- Valida datas reais; normaliza valores para vírgula decimal (o servidor rejeita separador de milhar).
- Dois comparativos: **atual × CBS+IBS** (bruto, sem créditos) e **Simples × regime normal** (só CBS/IBS). Cenário do Simples usa alíquota efetiva e atividade informadas pela pessoa.
- Os totais **excluem operações com problema**.
- Salva a análise (`POST /empresas/:cnpj/analises`; reenviar um lote corrigido substitui o anterior).
- ✅ Resultado guardado no navegador (ver 2.4); só os totais vão ao servidor.

### 3.5 Auditoria
- Lista operações com erro devolvido pela calculadora; permite corrigir NCM, NBS e classificação na tela, com busca nos catálogos.
- ⚠️ Corrigir uma linha **não recalcula o cenário do Simples**.
- ⚠️ As correções valem só enquanto a página estiver aberta.

### 3.6 Relatório white-label
- Cabeçalho com nome e logo do escritório, comparativos e resumo.
- **PDF = impressão do navegador** ("Salvar como PDF"). **"Excel" = arquivo CSV.**
- ❌ Não há Puppeteer nem ExcelJS.

### 3.7 Central DANFSe e Configurações
- **DANFSe:** gera o PDF a partir do XML de NFS-e autorizada, em lote ou individual, via `POST /v1/danfse`; falhas aparecem por arquivo.
- ❌ DANFSe avulso **sem XML** (digitando dados) não está disponível.
- ❌ Histórico e envio por e-mail do DANFSe: não existem.
- **Configurações:** dados e logo do escritório (`GET/PUT /me/escritorio`, PNG/JPEG/WebP até 300 KB, só por sessão), chaves de API (`/keys`), uso do plano, histórico.

---

## 4. Rotas reais do gateway

| Rota | Método | Para que serve |
|---|---|---|
| `/health` | GET | Saúde do gateway |
| `/planos` | GET | Planos e limites |
| `/auth/register` · `/auth/login` | POST | Conta e sessão |
| `/auth/esqueci` · `/auth/redefinir` | POST | Recuperação de senha |
| `/auth/confirmar` | POST | Confirma o e-mail pelo link |
| `/me/reenviar-confirmacao` | POST | Novo link de confirmação (sessão) |
| `/me` | GET | Conta atual |
| `/me/escritorio` | GET/PUT | Dados e logo do escritório |
| `/usage` · `/history` | GET | Uso do mês (inclui empresas) e histórico |
| `/keys` | GET/POST/DELETE | Chaves de API (`rtc_...`) |
| `/empresas` · `/empresas/ativa` · `/empresas/delete` | GET/POST | Carteira de CNPJs |
| `/empresas/:cnpj/analises` | POST | Salva totais de uma análise |
| `/empresas/:cnpj/analises/:id` | DELETE | Remove análise |
| `/empresas/:cnpj/dashboard` | GET | Visão geral |
| `/v1/calculo` · `/v1/regime-regular/calculo` | POST | Cálculo regime regular |
| `/v1/simples-nacional/calculo` · `/calculo-informado` · `/atividades` | POST/GET | Simples Nacional |
| `/v1/simulacoes/lote` | POST | Lote (até 200 operações por chamada) |
| `/v1/danfse` | POST | PDF do DANFSe |
| `/v1/versao` | GET | Versões das calculadoras |
| `/v1/dados/<tabela>` ou `/v1/tabelas/<tabela>` | GET | Tabelas de dados abertos (UFs, municípios, NCM, NBS, classificações) |
| `/admin/tenants/:id/plano` | POST | Trocar plano (exige `ADMIN_TOKEN`) |
| `/admin/usuarios/redefinicao` | POST | Gerar link de recuperação (exige `ADMIN_TOKEN`) |
| `/admin/usuarios/confirmacao` | POST | Confirmar e-mail ou gerar o link (exige `ADMIN_TOKEN`) |

Autenticação: sessão (token assinado) ou chave de API; limite de requisições por minuto e cotas mensais por plano.

---

## 5. Modelo de dados (SQLite)

| Tabela | Conteúdo |
|---|---|
| `tenants`, `users` | Escritórios e usuários (`senha_alterada_em` invalida sessões antigas) |
| `api_keys` | Hash SHA-256 das chaves |
| `usage_events` | Uso mensal e histórico de chamadas (formulário só com `STORE_PAYLOADS=true`) |
| `empresas` | CNPJs por escritório (chave `tenant_id + cnpj`) |
| `analises` | Totais por análise (base, tributos atuais, CBS, IBS, documentos, itens com problema) |
| `escritorios` | Nome, contato e logo para o relatório |
| `redefinicoes_senha` · `confirmacoes_email` | Hash do link, validade e uso (`users.email_confirmado_em` guarda a confirmação) |

Não existem as tabelas `simulacoes_lote` e `lote_itens` previstas na v1.0.

### Planos (valores **provisórios**, em `plans.js`)

| Plano | Simulações/mês | PDFs DANFSe/mês | Empresas |
|---|---|---|---|
| gratuito | 500 | 50 | 2 |
| profissional | 20.000 | 2.000 | 15 |
| ilimitado | sem limite | sem limite | sem limite |

Os números são sugestões minhas, não definição comercial.

---

## 6. Segurança

- Senhas com scrypt; sessões HMAC-SHA256 com data de emissão; chaves de API só como hash.
- Isolamento por escritório em todas as consultas de empresas e análises.
- Escape de todo dado exibido; validação de entradas (CNPJ, datas, tamanho de arquivos, limites do ZIP).
- Recuperação de senha sem revelar se o e-mail existe.
- Em produção: HTTPS por proxy reverso e repositório **privado**.

---

## 7. O que falta (ordem de importância)

1. **Validar com as calculadoras oficiais.** Rodar `ADMIN_TOKEN=... node scripts/verificar-integracao.mjs` na máquina com Docker; mede também a memória dos contêineres. Enviar `integracao-resultado.json` se algo falhar.
2. **Cobrança** (inexistente) e **valores reais dos planos**.
3. **Ligar o envio de e-mail:** a recuperação de senha e a confirmação dependem de um webhook (n8n, Zapier ou função sua). Sem ele, o operador repassa os links.
4. **DANFSe avulso sem XML**, histórico e envio por e-mail.
5. **Recalcular o cenário do Simples** ao corrigir na Auditoria.
6. **Excel de verdade (.xlsx)** e PDF gerado no servidor, se o cliente exigir.
7. **Para vender com SLA:** PostgreSQL, monitoramento, backups, CI/CD para atualizar as versões oficiais.
8. **Conferir antes de vender:** alíquotas nominais (`ALIQUOTA_CBS`, `ALIQUOTA_IBS_ESTADUAL`, `ALIQUOTA_IBS_MUNICIPAL`), licença das calculadoras oficiais, repositório privado.
9. **Testes de ponta a ponta** com Playwright versionados no repositório (hoje as verificações de tela foram feitas fora dele, em scripts de apoio).
10. Atualizar a apresentação de venda.

---

## 8. Definição de pronto

- [x] 7 telas funcionais no front-end, com dados reais do servidor ou do arquivo enviado
- [x] Isolamento por escritório e limite por plano
- [x] `npm test` passando (29 testes)
- [x] README e Manual atualizados
- [ ] Verificado contra as calculadoras oficiais
- [ ] Memória dos contêineres medida com carga real
- [ ] Cobrança, planos definidos, webhook de e-mail ligado
- [ ] Ambiente de produção (PostgreSQL, HTTPS, monitoramento, backups)
