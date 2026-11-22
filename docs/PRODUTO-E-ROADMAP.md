# Produto e roadmap

Este documento junta as recomendações de produto e de venda recebidas para o Simulador CBS e IBS e diz, para cada ponto, **o que já existe**, **o que existe em parte** e **o que ainda é plano**. Serve para não prometer ao cliente o que o sistema ainda não faz.

Legenda: ✅ existe · 🟡 parcial · 🗓️ planejado · ⛔ fora do escopo atual

## 1. Pontos de atenção técnicos

| Ponto | Status | Situação real |
|---|---|---|
| API única que roteia por regime (Simples ou regime regular) | 🟡 | O gateway expõe uma API única com autenticação, cota e histórico. A pessoa escolhe o regime na tela (`/v1/simulacoes/regime-normal` ou `/simples-nacional`). Falta guardar o perfil fiscal da conta e rotear sozinho. |
| Memória: limites da JVM (`-Xmx`) e dimensionamento por contêiner | 🟡 | Configurado no compose: 1 GiB por serviço Java com heap de 512 MiB, 192 MiB no DANFSe e 256 MiB no gateway, ajustáveis pelo `.env`. Os valores são estimativas e ainda não foram medidos com carga real: observe `docker stats` num lote grande antes de produção. |
| Contêineres oficiais sem estado | ✅ | Os três serviços não guardam dados do cliente. O histórico fica no banco do gateway. O XML e o PDF do DANFSe **não são guardados** de propósito (privacidade). Para guardar arquivos, é preciso adicionar armazenamento (S3 ou similar). |
| Atualização das regras e das alíquotas | 🟡 | As versões oficiais estão fixadas por commit em `versoes.txt`, e `scripts/verificar-atualizacoes.*` avisa quando há versão nova. Falta o pipeline automático (CI/CD) que monitora, testa e publica imagens novas, e permitir simular regras de datas anteriores com versão escolhida. Hoje a data da operação já vai para a calculadora; a versão do motor, não. |
| Assinatura digital (certificado A1) e comunicação com SEFAZ / Ambiente Nacional | ⛔ | O sistema calcula e gera o PDF; não emite nem transmite notas. Se isso entrar, deve ser um serviço separado. |

## 2. O que justifica a assinatura

| Diferencial | Status | Situação real |
|---|---|---|
| API única e normalizada | 🟡 | Ver acima. O formulário simplificado e o resultado legível já existem. |
| Atualização garantida e versionamento | 🗓️ | Depende do pipeline de versões do item 1. |
| Histórico e auditoria | 🟡 | Há histórico por conta. Faltam busca, memória de cálculo completa (o formulário só é guardado com `STORE_PAYLOADS=true`) e exportação de relatório. |
| Processamento em lote (XML, CSV) | 🟡 | Planilha CSV de até 500 operações, uma regime por vez, com totais, lista de problemas por linha e resultado em CSV (`POST /v1/simulacoes/lote`). Faltam o envio de XMLs de NF-e/NFS-e e o processamento em segundo plano para lotes maiores. |
| SLA e alta disponibilidade | 🗓️ | SQLite e uma instância. Para SLA: PostgreSQL, mais de uma instância do gateway, monitoramento e backups. |

## 3. Telas que vendem

| Tela | Status | Situação real |
|---|---|---|
| Simulador de impacto em lote (comparar o modelo atual com CBS/IBS e comparar Simples com regime regular) | 🟡 | O lote por CSV já calcula CBS e IBS de muitas operações. Falta a comparação: o modelo atual (ICMS, ISS, PIS, COFINS) não é calculado por nenhum dos motores da Receita, e comparar Simples com regime regular exige rodar os dois sobre os mesmos dados. |
| Auditoria de cadastro (NCM / classificação) | 🟡 | O lote lista, por linha da planilha, cada item que a calculadora recusou, com a mensagem em português; cada operação pode ser corrigida na tela (código com busca por nome, classificação, valor, atividade), recalculada e baixada em planilha corrigida. O formulário avisa quando a classificação não se aplica ao NCM/NBS. Faltam: validar contra a calculadora real, sugerir a classificação correta automaticamente, corrigir linhas ilegíveis (município inexistente etc.) e guardar o histórico de correções. |
| DANFSe em lote com logotipo | 🟡 | Gera o PDF de uma nota por vez. Faltam lote e logotipo do cliente. |
| Relatório “white-label” em PDF com a logo do escritório | 🗓️ | Hoje o resultado pode ser impresso pelo navegador, sem marca própria nem gráficos. |

## 4. Venda e aquisição (sugestões)

Estas são ideias de mercado, não funcionalidades:

- **Teste grátis sem cartão** na página inicial (ex.: até 20 XMLs). Hoje existe o plano gratuito por cadastro (500 simulações e 50 PDFs por mês). O envio de XMLs depende do lote.
- **Preço por CNPJ ativo**, que é como contadores pensam. Sugestão recebida: Plano Escritório até 15 CNPJs por R$ 197/mês e Plano Pro até 50 CNPJs por R$ 497/mês. Hoje os planos limitam **volume** (veja `gateway/src/plans.js`), não CNPJs, e não há cobrança integrada. Os valores são hipóteses a validar com clientes.
- **Primeiros clientes:** contadores consultivos no LinkedIn e Instagram que já falam da Reforma Tributária; acesso gratuito por 60 dias a 5 a 10 escritórios parceiros, em troca de feedback semanal e depoimentos.

## 5. Ordem sugerida de trabalho

1. Validar com as calculadoras reais e corrigir o que a Receita rejeitar.
2. ~~Fixar versões dos repositórios oficiais e limitar memória dos contêineres.~~ Feito; falta medir a memória com carga real.
3. ~~Busca de produto por nome e correção de erros na própria tela (auditoria).~~ Feito; falta validar contra as calculadoras reais.
4. Lote com XML, comparativo (modelo atual e CBS/IBS; Simples e regime regular) e relatório PDF com a marca do escritório. O lote por CSV já existe.
5. Cobrança, recuperação de senha, PostgreSQL e monitoramento (pré-requisitos para vender com SLA).
