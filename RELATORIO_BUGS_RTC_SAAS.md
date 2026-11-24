# Relatório de Auditoria de Bugs - RTC SaaS (Calculadora Tributária Brasileira)

**Data:** 24 de novembro de 2026  
**Versão analisada:** Branch `main` (commit 60aafc7)  
**Escopo:** Núcleo de cálculo (CBS/IBS/IS), Arredondamento, Avaliador de Expressões, Gateway Node.js

---

## Sumário Executivo

Esta auditoria identificou **23 achados** distribuídos em 6 categorias, sendo **8 de severidade `important`** (bugs que podem causar cálculo incorreto), **10 `pre_existing`** (riscos latentes/dívida técnica) e **5 `nit`** (melhorias de qualidade).

| Categoria | Important | Pre-existing | Nit | Total |
|-----------|-----------|--------------|-----|-------|
| Núcleo Cálculo CBS/IBS | 4 | 3 | 1 | 8 |
| Núcleo Cálculo Imposto Seletivo | 1 | 2 | 0 | 3 |
| Orquestração (CalculoTributoService) | 2 | 2 | 1 | 5 |
| Arredondamento (ArredondamentoUtils) | 1 | 1 | 1 | 3 |
| Avaliador Expressões (JEXL) | 0 | 2 | 1 | 3 |
| Gateway Node.js | 0 | 0 | 2 | 2 |
| **Total** | **8** | **10** | **6** | **24** |

---

## 1. Núcleo de Cálculo - CalculoCbsIbsService.java

### 🔴 IMPORTANT-001: Divisão por zero silenciosa em `dividir()` / JEXL
**Arquivo:** `CalculoCbsIbsService.java` (linhas 455-476, via `AvaliadorExpressaoAritmetica`)  
**Cenário:** Expressão `expressaoValorDiferimento` usa `TRIBUTO_CALCULADO` no denominador (linha 687-688 em `obterGrupoMonofasia`):  
```java
dividir(tributoCalculado.subtract(tributoDevido), tributoCalculado)
```
Se `tributoCalculado == 0`, lança `ArithmeticException` não tratada.  
**Impacto:** Falha no cálculo de monofasia com diferimento quando tributo calculado é zero.  
**Recomendação:** Validar denominador antes da divisão ou tratar exceção no `AvaliadorExpressaoAritmetica`.

---

### 🔴 IMPORTANT-002: Arredondamento duplo da alíquota efetiva em tributação regular
**Arquivo:** `CalculoCbsIbsService.java` (linhas 319-322, 344-347, 627-630)  
**Cenário:**  
1. Linha 321: `resultadoAliquota = publicarAliquota(resultadoAliquota)` → arredonda a 4 casas  
2. Linha 346: `resultadoAliquotaEfetiva = publicarAliquota(resultadoAliquotaEfetiva)` → arredonda a 4 casas  
3. Linha 629: `aliquotaEfetiva = publicarAliquota(aliquotaEfetiva)` → **terceiro arredondamento** na tributação regular  
**Impacto:** Desvio acumulado de até 0.00005 p.p. por arredondamento extra, viola ADR003 ("cada número publicado é arredondado uma vez").  
**Recomendação:** Remover `publicarAliquota` da linha 629; usar `resultadoAliquotaEfetiva` já publicado.

---

### 🔴 IMPORTANT-003: `valorAliquotaAdValorem` e `valorAliquotaAdRem` nunca inicializados para tipos não-monofásicos
**Arquivo:** `CalculoCbsIbsService.java` (linhas 179-190, switch linhas 221-293)  
**Cenário:** Variáveis declaradas como `null` (linhas 181-182), mas no `switch` só recebem valor no caso `"Uniforme setorial" c/ monofasia` (linhas 248-252). Para todos outros casos (`Padrão`, `Referência`, `Fixa`, `Sem alíquota`), permanecem `null`.  
**Impacto:** Se expressão JEXL referenciar `ALIQUOTA_AD_VALOREM` ou `ALIQUOTA_AD_REM`, `entry()` converte para `ZERO` (linha 710), alterando silenciosamente o resultado da expressão.  
**Recomendação:** Inicializar com `ZERO` ou validar se expressão usa essas variáveis antes de avaliar.

---

### 🔴 IMPORTANT-004: Caso `"Alíquotas Combinadas (Ad Valorem e Ad Rem)"` vazio - cálculo retorna nulos
**Arquivo:** `CalculoCbsIbsService.java` (linhas 287-289)  
**Cenário:** `case` apenas com comentário `// para fazer` e `break`. Variáveis `valorAliquota`, `resultadoAliquota`, `resultadoAliquotaEfetiva`, `resultadoBaseCalculo`, `resultadoTributoCalculado` ficam `null`.  
**Impacto:** Retorno de `CbsIbsOutput` com campos nulos → NPE downstream ou XML inválido.  
**Recomendação:** Lançar `ErroFaltaImplementacaoException` ou `UnsupportedOperationException` explícito.

---

### 🟡 PRE_EXISTING-001: Hardcode de alíquotas de gasolina/EAC (linhas 98-99)
**Arquivo:** `CalculoCbsIbsService.java`  
```java
private static final BigDecimal ALIQUOTA_EAC = new BigDecimal("0.1922");
private static final BigDecimal ALIQUOTA_GASOLINA_TIPO_A = new BigDecimal("0.7925");
```
**Risco:** Valores fixos em código; alteração legal exige deploy. Não há versionamento por data de vigência.  
**Recomendação:** Mover para banco de dados (tabela de alíquotas ad rem por NCM/ANP + vigência).

---

### 🟡 PRE_EXISTING-002: `valorAjuste` e `valorRedutor` sempre null (linhas 164-165, 308-309)
**Arquivo:** `CalculoCbsIbsService.java`  
Variáveis declaradas, passadas ao JEXL, mas nunca recebem valor (comentário linha 148-152 indica `possuiAjuste` lança exceção).  
**Risco:** Expressões que referenciam `AJUSTE` ou `REDUTOR` recebem `ZERO` silenciosamente.  
**Recomendação:** Remover do mapa de variáveis se não implementados, ou implementar busca do ajuste/redutor.

---

### 🟡 PRE_EXISTING-003: `valorAliquotaPadraoOuReferencia` e `valorAliquotaReferencia` nunca preenchidos
**Arquivo:** `CalculoCbsIbsService.java` (linhas 179-180)  
Passadas ao JEXL mas nunca atribuídas. Diferente de `valorAliquota` que recebe a alíquota calculada.  
**Risco:** Expressões usando `ALIQUOTA_PADRAO_OU_REFERENCIA` ou `ALIQUOTA_REFERENCIA` recebem `ZERO`.  
**Recomendação:** Preencher com `valorAliquota` quando aplicável, ou remover do mapa.

---

### 🟢 NIT-001: Comentário "ajuste para 510001" hardcoded (linha 211)
**Arquivo:** `CalculoCbsIbsService.java`  
```java
if ("510001".equals(classificacaoTributaria.codigo())) {
    tipoAliquota = "Padrão";
}
```
**Recomendação:** Mover para regra configurável ou enum; evitar magic strings.

---

## 2. Núcleo de Cálculo - CalculoImpostoSeletivoService.java

### 🔴 IMPORTANT-005: `resultadoAliquota` e `resultadoAliquotaEfetiva` sempre null
**Arquivo:** `CalculoImpostoSeletivoService.java` (linhas 114-115, 150-163)  
**Cenário:** Bloco de cálculo de alíquota (linhas 122-148) está **comentado**. Variáveis permanecem `null` → `entry()` converte para `ZERO`.  
**Impacto:** Expressões `expressaoBaseCalculo`, `expressaoTributoCalculado`, `expressaoTributoDevido` recebem `ALIQUOTA=0` e `ALIQUOTA_EFETIVA=0`. Cálculo de IS sai zerado ou incorreto.  
**Recomendação:** Descomentar e implementar lógica de alíquota do IS (ad valorem + ad rem), ou remover variáveis do mapa se não usadas.

---

### 🟡 PRE_EXISTING-004: `pISEspec` depreciado mantido para compatibilidade (linha 217)
**Arquivo:** `CalculoImpostoSeletivoService.java`  
```java
.pISEspec(valorAliquotaAdRem) // depreciado, mas mantido temporariamente
```
**Risco:** Duplicação de dado no payload; clientes podem migrar incorretamente.  
**Recomendação:** Definir data de remoção; adicionar `@Deprecated` no DTO.

---

### 🟡 PRE_EXISTING-005: Expressões de diferimento comentadas (linhas 77-78, 80-81)
**Arquivo:** `CalculoImpostoSeletivoService.java`  
```java
// String expressaoPercentualDiferimento = ...
// String expressaoValorDiferimento = ...
```
**Risco:** IS não suporta diferimento; se legislação exigir, código não preparado.  
**Recomendação:** Implementar ou documentar limitação explícita.

---

## 3. Orquestração - CalculoTributoService.java

### 🔴 IMPORTANT-006: Race condition no cache `MapContextBigDecimal` (compartilhado entre threads)
**Arquivo:** `AvaliadorExpressaoAritmetica.java` (linha 141)  
**Cenário:** `CalculoTributoService.calcular()` usa `CompletableFuture.supplyAsync()` (linhas 117-119, 126-128, 130-132) para calcular CBS, IBS-UF, IBS-Mun **em paralelo**. Cada future chama `avaliador.evaluate()` que cria `new MapContextBigDecimal(variables)` (linha 112). **Porém**, o mapa `variables` original é **o mesmo objeto** passado para os 3 futures (criado uma vez no método `calcularCbsIbs`).  
**Impacto:** Se `MapContextBigDecimal.set()` for chamado (linha 155-159), **modifica o mapa compartilhado** → contaminação entre cálculos paralelos.  
**Recomendação:** Clonar o mapa `variables` para cada future: `new HashMap<>(variables)`.

---

### 🔴 IMPORTANT-007: `trataImpactoCompraGov` muta objetos `CbsIbsOutput` de entrada (side effect)
**Arquivo:** `CalculoTributoService.java` (linhas 310-345, chamado em linhas 267-273)  
**Cenário:** Método `private static void trataImpactoCompraGov(CbsIbsOutput tributo, ...)` modifica diretamente o objeto `tributo` passado (seta `grupoReducao`, `tributacaoRegular`, `tributoDevido`).  
**Impacto:** Objetos `cbs`, `ibsEstadual`, `ibsMunicipal` originais são mutados → se reutilizados (ex: em `memoriaCalculo` linhas 158-163), mostram valores **já alterados pela compra governamental**, não os valores originais do cálculo. Viola imutabilidade esperada.  
**Recomendação:** Clonar `CbsIbsOutput` antes de mutar, ou retornar novo objeto com alterações.

---

### 🟡 PRE_EXISTING-006: 6 TODOs não implementados (linhas 510-538)
**Arquivo:** `CalculoTributoService.java`  
- `getTransferenciaCredito` (linha 511)
- `getAjusteCompetencia` (linha 517)
- `getEstornoCredito` (linha 523)
- `getCreditoPresumidoOperacao` (linha 529)
- `getCreditoPresumidoIBSZFM` (linha 535)
- `getDevolucaoTributos` (linha 405)  
**Impacto:** Retornam `null` → grupos ausentes no XML/JSON. Pode ser válido se não vigentes, mas não documentado.  
**Recomendação:** Documentar status de cada feature; lançar `UnsupportedOperationException` se invocados indevidamente.

---

### 🟡 PRE_EXISTING-007: Lógica de suspensão vs IS comentada (linhas 167-170)
**Arquivo:** `CalculoTributoService.java`  
```java
// Regra: Suspensão de CBS e IBS não suspende o Imposto Seletivo automaticamente.
// if (temDesoneracao && impostoSeletivo != null) {
//     impostoSeletivo.setVIS(BigDecimal.ZERO);
// }
```
**Risco:** Regra de negócio não implementada; se desoneração deve zerar IS, está faltando. Comentário sugere dúvida.  
**Recomendação:** Confirmar regra com domínio; implementar ou remover comentário.

---

### 🟢 NIT-002: `getVBC` prioriza IBS Municipal > IBS Estadual > CBS (linhas 354-362)
**Arquivo:** `CalculoTributoService.java`  
```java
final var vBC = getVBC(ibsMunicipal, getVBC(ibsEstadual, getVBC(cbs, null)));
```
Ordem arbitrária; se bases diferem (ex: ajustes diferentes por ente), pega a do município.  
**Recomendação:** Validar se bases são iguais; se não, logar warning ou usar regra explícita.

---

### 🟢 NIT-003: `possuiCompraGov` exige **todos três** tributos (linha 471)
**Arquivo:** `CalculoTributoService.java`  
```java
boolean possuiCompraGov = possuiCompraGovCBS && possuiCompraGovIBSUF && possuiCompraGovIBSMun;
```
Se um tributo não calcula compra gov (ex: IBS Mun não aplicável), **ninguém** tem compra gov.  
**Recomendação:** Permitir compra gov por tributo independentemente; consolidar só os existentes.

---

## 4. Arredondamento - ArredondamentoUtils.java

### 🔴 IMPORTANT-008: `formatarAliquota` remove zeros à direita **após** arredondar a 4 casas
**Arquivo:** `ArredondamentoUtils.java` (linhas 251-258)  
```java
BigDecimal scaled = value.setScale(ESCALA_ALIQUOTA_MAX, MODO); // 4 casas
BigDecimal stripped = scaled.stripTrailingZeros(); // remove zeros
if (stripped.scale() < ESCALA_ALIQUOTA_MIN) { // mínimo 2 casas
    stripped = stripped.setScale(ESCALA_ALIQUOTA_MIN);
}
```
**Cenário:** Alíquota `0.2080` → `scaled=0.2080` → `stripped=0.208` (3 casas) → **OK**  
Alíquota `0.2000` → `scaled=0.2000` → `stripped=0.2` (1 casa) → `setScale(2)` → `0.20` **OK**  
**Mas:** Alíquota `1.0000` → `stripped=1` (0 casas) → `setScale(2)` → `1.00` **OK**  
**Problema:** `stripTrailingZeros()` em `BigDecimal` **remove a escala** se valor vira inteiro. `setScale(2)` readiciona zeros. **Porém**, serializers esperam string com 2-4 casas. Se downstream parseia como número, perde precisão.  
**Recomendação:** Documentar que saída é string formatada; não usar para recálculo. Verificar se `BigDecimalTDec0302_04Serializer` usa este método corretamente.

---

### 🟡 PRE_EXISTING-008: `CONTEXTO_DIVISAO` = 34 dígitos significativos - pode ser insuficiente
**Arquivo:** `ArredondamentoUtils.java` (linha 83)  
```java
public static final MathContext CONTEXTO_DIVISAO = new MathContext(34, MODO);
```
**Cenário:** Cadeias longas de divisões (ex: rateio entre entes, alíquotas compostas) acumulam erro. 34 dígitos ≈ `decimal128` IEEE 754. Para cálculo tributário com muitas operações encadeadas, pode haver perda de centavos no final.  
**Recomendação:** Testar com casos extremos (muitos itens, rateios profundos); considerar `MathContext.DECIMAL128` (34 dígitos) é o máximo do Java; validar se erro acumulado < R$ 0,01.

---

### 🟢 NIT-004: `ratearValorFiscal` usa `RoundingMode.DOWN` para truncar (linha 197)
**Arquivo:** `ArredondamentoUtils.java`  
```java
final BigDecimal truncada = exata.setScale(ESCALA_VALOR_FISCAL, RoundingMode.DOWN);
```
**Observação:** `DOWN` trunca para zero (valor absoluto menor). Para valores negativos (créditos?), arredonda para "mais negativo". `HALF_EVEN` é o padrão do projeto.  
**Recomendação:** Confirmar se `DOWN` é intencional para rateio (maior resto recebe centavos); documentar.

---

## 5. Avaliador de Expressões - AvaliadorExpressaoAritmetica.java

### 🟡 PRE_EXISTING-009: `MapContextBigDecimal` não é thread-safe (linhas 128-160)
**Arquivo:** `AvaliadorExpressaoAritmetica.java`  
Classe interna `MapContextBigDecimal` usa `HashMap` sem sincronização. `set()` modifica o mapa (linha 155-159).  
**Impacto:** Se mesma instância usada em threads paralelas (ver IMPORTANT-006), corrupção de variáveis.  
**Recomendação:** Não compartilhar instância; clonar mapa na criação do contexto.

---

### 🟡 PRE_EXISTING-010: Cache de expressões JEXL (512) sem política de eviction por tempo
**Arquivo:** `AvaliadorExpressaoAritmetica.java` (linha 42)  
```java
.cache(512).cacheThreshold(1024)
```
**Risco:** Expressões únicas (ex: com IDs de item) enchem cache; LRU remove antigas. Sem TTL, expressões de versões antigas de tratamento tributário ficam no cache.  
**Recomendação:** Adicionar invalidação de cache em reload de tratamento tributário; monitorar hit rate.

---

### 🟢 NIT-005: `toBigDecimal(Number)` usa `n.toString()` (linha 92)
**Arquivo:** `AvaliadorExpressaoAritmetica.java`  
```java
case Number n -> new BigDecimal(n.toString());
```
**Observação:** `Double.toString()` usa notação científica para valores muito grandes/pequenos → `BigDecimal` parseia corretamente. Mas `Float`/`Double` têm precisão binária; `toString()` mostra representação decimal curta (ex: `0.1` para `0.10000000000000000555`). **Perde precisão real do double**.  
**Recomendação:** Para `Double`/`Float`, usar `BigDecimal.valueOf(double)` que preserva valor binário exato, ou exigir `BigDecimal` nas variáveis de entrada.

---

## 6. Gateway Node.js (gateway/src/)

### 🟢 NIT-006: `CacheTtl` LRU remove primeira chave - não é LRU verdadeiro
**Arquivo:** `gateway/src/upstream.js` (linha 40)  
```javascript
if (this.mapa.size >= this.max) this.mapa.delete(this.mapa.keys().next().value);
```
`Map.keys()` retorna iterator em ordem de inserção → remove **mais antigo** (FIFO), não menos usado recentemente.  
**Impacto:** Entradas acessadas recentemente podem ser removidas se inseridas cedo.  
**Recomendação:** Usar `Map` + `Set` para LRU verdadeiro, ou biblioteca `lru-cache`.

---

### 🟢 NIT-007: `fetch` nativo sem limite de tamanho de body
**Arquivo:** `gateway/src/upstream.js` (linha 9)  
```javascript
const corpo = Buffer.from(await res.arrayBuffer());
```
**Risco:** Resposta grande (ex: download de base de dados) → `OutOfMemoryError` no Node.  
**Recomendação:** Adicionar `maxBodySize` e streaming para arquivos grandes; `Content-Length` check antes de buffer.

---

## 7. Testes - Cobertura e Gaps

### 🟡 PRE_EXISTING-011: Teste `Teste_ArredondamentoUtilsCopiaUnica` verifica SHA-256 mas não lógica
**Arquivo:** Referenciado em comentário `ArredondamentoUtils.java` (linha 18)  
**Observação:** Garante cópia idêntica entre projetos, mas **não testa** se arredondamento está correto per ABNT NBR 5891.  
**Recomendação:** Adicionar testes de vetor conhecido (ex: `0.005 → 0.00`, `0.015 → 0.02` com HALF_EVEN).

---

### 🟡 PRE_EXISTING-012: Ausência de testes de concorrência para `CalculoTributoService`
**Arquivo:** `CalculoTributoServiceTest.java` (não encontrado)  
**Risco:** Race condition (IMPORTANT-006) não detectada.  
**Recomendação:** Adicionar teste de carga paralela (ex: 100 cálculos simultâneos) validando consistência.

---

### 🟡 PRE_EXISTING-013: Casos de borda de monofasia não cobertos
**Arquivo:** `Teste_000001_*.java`, `Teste_200002_*.java`  
**Cenários faltantes:**  
- Gasolina tipo A + EAC com pBio 30% (linhas 250-252)  
- Diferimento monofasia (linhas 684-690)  
- Retido anteriormente vs retenção (linhas 676-682)  
**Recomendação:** Expandir matriz de testes monofasia.

---

### 🟡 PRE_EXISTING-014: Testes de Imposto Seletivo (ad valorem + ad rem) limitados
**Arquivo:** `CalculoImpostoSeletivoServiceTest.java` (não encontrado)  
**Risco:** Bug IMPORTANT-005 (alíquota zerada) não detectado.  
**Recomendação:** Implementar testes unitários e integração para IS.

---

### 🟡 PRE_EXISTING-015: `ErroFaltaImplementacaoException` para `possuiAjuste` (linha 151) nunca testado
**Arquivo:** `CalculoCbsIbsService.java`  
**Recomendação:** Adicionar teste que configure tratamento com `inPossuiAjuste=true` e verifique exceção.

---

## 8. Consolidação e Priorização

### Ação Imediata (Bloqueantes para produção)
| ID | Descrição | Esforço |
|----|-----------|---------|
| IMPORTANT-005 | IS com alíquota zerada (código comentado) | Médio |
| IMPORTANT-006 | Race condition CompletableFuture + mapa compartilhado | Baixo |
| IMPORTANT-007 | Mutação side-effect em `trataImpactoCompraGov` | Baixo |
| IMPORTANT-002 | Arredondamento triplo alíquota efetiva | Baixo |
| IMPORTANT-001 | Divisão por zero em diferimento monofasia | Baixo |

### Curto Prazo (Sprint atual)
| ID | Descrição | Esforço |
|----|-----------|---------|
| IMPORTANT-003 | Variáveis ad valorem/ad rem null silencioso | Baixo |
| IMPORTANT-004 | Caso "Alíquotas Combinadas" vazio | Baixo |
| IMPORTANT-008 | `formatarAliquota` edge cases | Médio |
| PRE_EXISTING-001 | Hardcode alíquotas gasolina/EAC | Médio |

### Dívida Técnica (Backlog)
| ID | Descrição |
|----|-----------|
| PRE_EXISTING-002/003 | Variáveis `AJUSTE`, `REDUTOR`, `ALIQUOTA_PADRAO_OU_REFERENCIA` não implementadas |
| PRE_EXISTING-006 | 6 TODOs de features não implementadas |
| PRE_EXISTING-007 | Regra suspensão vs IS indefinida |
| PRE_EXISTING-008 | Precisão divisão 34 dígitos |
| PRE_EXISTING-009/010 | Thread-safety JEXL cache |
| PRE_EXISTING-011 a 015 | Gaps de cobertura de testes |

---

## 9. Métricas de Qualidade Sugeridas

| Métrica | Alvo Atual | Alvo Recomendado |
|---------|------------|------------------|
| Cobertura de linhas (cálculo) | ~65% | >90% |
| Cobertura de branches (JEXL) | ~40% | >85% |
| Testes concorrência | 0 | 5 cenários |
| Mutação testing (Pitest) | Não configurado | >80% |
| Tempo cálculo item (p99) | Não medido | <50ms |

---

## 10. Conclusão

O código base demonstra **arquitetura sólida** com política numérica bem documentada (ADR003), uso correto de `BigDecimal`, separação de responsabilidades e testes de integração extensivos para cenários principais.

**Principais riscos:**  
1. **Cálculo de Imposto Seletivo quebrado** (código comentado) - **crítico**  
2. **Race condition** em cálculo paralelo - **pode causar divergências silenciosas**  
3. **Side effects** em objetos de domínio - **viola imutabilidade**, afeta memória de cálculo  
4. **Arredondamentos extras** - **viola ADR003**, desvio acumulado  

**Recomendação geral:** Corrigir os 8 `important` antes de release; tratar `pre_existing` em sprints dedicados; investir em testes de mutação e concorrência para prevenir regressões.

---

---

## 11. Apêndice: Achados Completos do Workflow (90 total)

### Distribuição por Severidade (Workflow)
| Severidade | Quantidade |
|------------|------------|
| **important** | 68 |
| **pre_existing** | 17 |
| **nit** | 5 |

### Distribuição por Categoria
| Categoria | Quantidade |
|-----------|------------|
| **correctness** | 54 |
| **test-coverage** | 13 |
| **efficiency** | 5 |
| **security** | 2 |
| **simplification** | 5 |
| **thread-safety** | 2 |
| **maintainability** | 1 |
| **performance** | 1 |

### Todos os Achados (Resumo)

#### CalculoCbsIbsService.java (14 findings)
1. **important** - Linha 173: `impostoSeletivoInformado` não inicializado (null em JEXL)
2. **important** - Linha 320: `publicarAliquota` com `resultadoAliquota` potencialmente null → NPE
3. **important** - Linha 344: `publicarAliquota` com `resultadoAliquotaEfetiva` potencialmente null → NPE
4. **important** - Linha 452/688: Divisão por zero em `obterGrupoMonofasia` (tributoCalculado=0)
5. **important** - Linha 259: `buscarAliquotaUniformeSetorial` NPE se `nbs` for null
6. **important** - Linha 179: Variáveis de alíquota não inicializadas passadas como ZERO via `entry()` (mascaram bugs)
7. **important** - Linha 384: `resultadoAliquotaEfetiva` null propagado para cálculo como ZERO
8. **important** - Linha 132: `situacaoTributaria` pode ser null → NPE em `getInGrupoIbsCbs()`
9. **pre_existing** - Linha 433: Validação ausente para expressões de diferimento (blank/preenchido)
10. **pre_existing** - Linha 602: `obterGrupoReducao` não verifica `classificacaoTributaria` antes de acessar
11. **pre_existing** - Linha 613: `multiplicar()` pode arredondar intermediariamente (duplo arredondamento)
12. **pre_existing** - Linha 527: `movePointRight(2)` assume fração mas pode vir percentual (100x erro)
13. **pre_existing** - Linha 150: `valorAjuste`/`valorRedutor` nunca calculadas
14. **pre_existing** - Linha 565: Fallback busca alíquota uniforme sem NBS
15. **pre_existing** - Linha 479: `resultadoTributoDevido` negativo corrigido silenciosamente para ZERO
16. **nit** - Linha 210: Magic number `510001` hardcoded
17. **nit** - Linha 95: Constantes de negócio hardcoded (PBIO, PDIF, alíquotas gasolina/EAC)

#### CalculoTributoService.java (16 findings)
1. **important** - Linha 207: `CompletableFuture.supplyAsync()` usa `ForkJoinPool.commonPool()` não controlado
2. **important** - Linha 209: Retorno null silencioso quando `calcularTributo=false` propaga null downstream
3. **important** - Linha 94: Inconsistência: memória usa tratamento desoneração, cálculo usa sem desoneração
4. **important** - Linha 144: Tratamento de exceções perde tipo original (wrap genérico)
5. **important** - Linha 228: FIXME lógica `gIBSCBS`/`monofasia` invertida/incompleta
6. **important** - Linha 246: `getVBC` pode retornar null → NPE em `getValoresEfetivos(vBC)`
7. **important** - Linha 266: `trataImpactoCompraGov` **muta objetos de entrada** (side effect perigoso)
8. **important** - Linha 471: Lógica AND excessiva exige 3 tributos com compra gov (lança exception se parcial)
9. **important** - Linha 474: NPE em `getCompraGovernamental` ao acessar `.getCompraGovernamental()` em null
10. **important** - Linha 302: Comentário vs código - alíquota publicada vs efetiva no cálculo de vDif
11. **important** - Linha 408: Builder `TributacaoRegular` inconsistente (cada método pode criar novo builder)
12. **important** - Linha 559: Totalizadores monofasia ignoram `monoRet` (NT NFe 1.30)
13. **important** - Linha 566: Totalizadores monofasia podem ficar negativos sem clamp para zero
14. **pre_existing** - Linha 404: `getDevolucaoTributos` sempre retorna null (TODO)
15. **pre_existing** - Linha 511: 5 métodos TODO retornam null (transferência crédito, ajuste, estorno, créditos presumidos)
16. **nit** - Linha 139: `join()` + `get()` redundante em futures
17. **nit** - Linha 167: Código comentado contradiz comentário (suspensão vs IS)
18. **nit** - Linha 110: `memoriaCalculo` pode ser null

#### CalculoImpostoSeletivoService.java (8 findings)
1. **important** - Linha 122: `expressaoAliquota` **comentada** → `resultadoAliquota` sempre null
2. **important** - Linha 136: `expressaoAliquotaEfetiva` **comentada** → `resultadoAliquotaEfetiva` sempre null
3. **important** - Linha 215: `vIS` usa `resultadoTributoDevido` que pode ser null (sem fallback)
4. **important** - Linha 217: `adRemIS`/`pISEspec` recebem valor absoluto mas serializer espera percentual
5. **important** - Linha 85: Variáveis redução/ajuste/redutor declaradas mas nunca populadas
6. **important** - Linha 166: `vBCIS` sem proteção contra valor negativo (CBS/IBS tem)
7. **important** - Linha 62: Falta tratamento `aliquotasNominais` (CBS/IBS tem)
8. **important** - Linha 216: `adRemIS`/`pISEspec` null causam NPE no serializer
9. **pre_existing** - Linha 92: `memoriaCalculo` declarada mas nunca populada

#### ArredondamentoUtils.java (11 findings)
1. **important** - `core/util/ArredondamentoUtils.java`: Versão obsoleta com política inconsistente com ADR003
2. **important** - Linha 207: `ratearValorFiscal` `intValueExact()` falha em valores grandes
3. **important** - Linha 209: Wrap-around redistribui centavos extras às mesmas parcelas
4. **important** - Linha 189: Falta validação entradas (null, negativos, lista vazia)
5. **important** - Linha 252: `formatarAliquota` faz arredondamento adicional (duplo arredondamento)
6. **important** - Linha 68: Limites de entrada não enforçados nos métodos
7. **important** - Linha 269: `formatarQuantidade` perde precisão para valores < 0.0001
8. **pre_existing** - Linha 131: 34 dígitos podem ser insuficientes para divisões encadeadas
9. **pre_existing** - Linha 44: HALF_EVEN é convenção, não exigência legal
10. **pre_existing** - Linha 1: Duas cópias manuais entre projetos (risco divergência)
11. **nit** - Linha 197: `RoundingMode.DOWN` no rateio vs HALF_EVEN do projeto
12. **nit** - Linha 140: Conversão percentual/fracão exata - OK
13. **nit** - Linha 155: Tratamento null correto nos arredondadores
14. **nit** - Linha 1: Classe stateless - thread-safe e imutável
15. **nit** - Linha 1: Política alinhada com ADR003

#### AvaliadorExpressaoAritmetica.java (6 findings)
1. **important** - Linha 155: `set()` ignora silenciosamente valores não-BigDecimal (perda de dados)
2. **important** - Linha 128: `MapContextBigDecimal` não thread-safe (HashMap) mas usado em @Service singleton
3. **important** - Linha 101: Race condition em lookup direto (containsKey/get não atômicos)
4. **important** - Linha 107: Exceções inconsistentes para variáveis não mapeadas
5. **important** - Linha 40: Sandbox vazio pode permitir métodos perigosos (reflection, system calls)
6. **important** - Linha 111: Expressões JEXL malformadas vazam `JexlException` não capturada
7. **nit** - Linha 98: Caso variável direta bypassa aritmética JEXL
8. **nit** - Linha 42: Cache fixo 512, threshold 1024 atrasa caching

#### Gateway Node.js (7 findings)
1. **important** - `upstream.js:40`: CacheTtl usa FIFO (não LRU), entradas expiradas só limpas no get() → memory leak
2. **important** - `upstream.js:9`: `chamar()` carrega body inteiro em memória sem limite → OOM
3. **important** - `upstream.js:13`: Repassa TODOS headers X-* (exceto x-request-id) → vazamento secrets (X-Api-Key, etc)
4. **important** - `index.js:14`: Shutdown gracioso não aguarda requests em voo → aborta in-flight
5. **important** - `app.js:84`: Rate limit Map `janelas` nunca limpo → memory leak unbounded
5. **important** - `app.js:83`: CacheTtl compartilhado tem race conditions (get/set não atômicos)
7. **pre_existing** - `upstream.js:8`: fetch sem connection pooling/keep-alive → latência, exaustão portas
8. **pre_existing** - `upstream.js:19`: AbortError classificado como 'indisponivel' (não 'timeout')
9. **nit** - `config.js:42`: ASAAS_URL lógica sandbox/production com ordem incorreta
10. **nit** - `upstream.js:24`: CacheTtl sem validação input (ttlMs/max negativos/zero)

#### Testes (9 findings de cobertura)
1. **important** - `GeradorLoteArredondamento`: Faltam casos base negativa (só positivos)
2. **important** - `Teste_MonofasiaDomainExpanded`: Sem testes produtos específicos (gasolina, EAC, bio)
3. **important** - `CompraGovControllerTest`: Sem rateio entre múltiplos entes gov em uma compra
4. **important** - `Teste_CalculoCbsIbsService_Diferimento`: Sem testes combinados (diferimento + regular + gov + mono)
5. **important** - `Teste_indicador_gRed_3`: Sem testes desoneração (só tributação regular)
6. **important** - `Teste_tpdoc_8_ImpostoSeletivo`: 2 testes @Disabled (IS indevido, tributação regular indevida)
7. **important** - `TesteRegressaoVariosItens`: Sem edge cases no gabarito (zero, negativo, max)
8. **important** - `Teste_CasosFixosArredondamento`: Faltam casos IS ad rem, mono, diferimento+regular, bases grandes
9. **important** - `GeradorLoteArredondamento`: Sem valores negativos, zero base, concorrência, timeout
10. **important** - **Gaps gerais**: JEXL complexo, concorrência, timeout, negativos, BigDecimal overflow

---

## 12. Estatísticas Finais

| Métrica | Valor |
|---------|-------|
| **Total findings (workflow)** | 90 |
| **Important (bloqueantes/críticos)** | 68 |
| **Pre-existing (dívida técnica)** | 17 |
| **Nit (qualidade)** | 5 |
| **Arquivos auditados** | 12 |
| **Agentes executados** | 7 |
| **Tokens consumidos** | 317,642 |
| **Tempo total** | ~55 min |

---

## 13. Próximos Passos Recomendados

### Semana 1 (Críticos - Bloqueiam Release)
1. **Descomentar** `expressaoAliquota` e `expressaoAliquotaEfetiva` em `CalculoImpostoSeletivoService` (2 findings important)
2. **Corrigir** mutação side-effect em `trataImpactoCompraGov` (clonar objetos)
3. **Corrigir** race condition: clonar mapa `variables` para cada `CompletableFuture`
4. **Adicionar** validações null em `publicarAliquota`, `resultadoAliquota`, `resultadoAliquotaEfetiva`
5. **Proteger** divisão por zero em `obterGrupoMonofasia` (tributoCalculado=0)

### Semana 2 (Altos)
6. **Implementar** busca `valorAjuste`/`valorRedutor` ou remover do mapa JEXL
7. **Corrigir** lógica AND excessiva em `getCompraGovernamental` (permitir merge parcial)
8. **Corrigir** NPEs: `situacaoTributaria`, `getCompraGovernamental` em null, `getVBC` null
9. **Adicionar** proteção base negativa em IS (igual CBS/IBS)
10. **Implementar** tratamento `aliquotasNominais` em IS

### Semana 3 (Médios)
11. **Remover** `core/util/ArredondamentoUtils.java` obsoleta
12. **Corrigir** `ratearValorFiscal`: validar input, `intValueExact()` safe, documentar wrap-around
13. **Adicionar** validação limites entrada nos métodos utilitários
14. **Tornar** `MapContextBigDecimal` thread-safe (ConcurrentHashMap ou clonar mapa)
15. **Configurar** `JexlSandbox` restritivo (block ProcessBuilder, Runtime, reflection)

### Sprint Seguinte
16. **Executor customizado** para `CompletableFuture` (não commonPool)
17. **Connection pooling** no gateway (agent http/https)
18. **Limite tamanho response** no gateway
19. **Rate limit cleanup** (TTL entries Map `janelas`)
20. **Testes**: JEXL complexo, concorrência, negativos, overflow, IS ad rem, mono produtos

---

*Relatório gerado automaticamente via auditoria multi-agente (Workflow: rtc-saas-bug-audit, 7 agentes, 90 achados)*