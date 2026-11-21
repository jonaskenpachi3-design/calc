# Imagem para as calculadoras Java da Receita (regime regular e Simples Nacional).
# Usa o Maven da imagem oficial: o repositorio da Receita nao inclui o maven-wrapper.jar.
# Uso (via docker-compose): --build-arg JAR=api-regime-geral.jar, contexto = vendor/<repo>
FROM maven:3-eclipse-temurin-25 AS build
WORKDIR /src
COPY . .
RUN mvn -B -q clean package -DskipTests

# Gera o banco SQLite (somente leitura em producao) com os scripts Flyway oficiais.
FROM build AS dbinit
CMD ["sh", "-c", "mkdir -p /out && mvn -B flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf '-Dflyway.url=jdbc:sqlite:file:/out/calculadora-pro.db?date_class=TEXT&foreign_keys=ON'"]

FROM eclipse-temurin:25-jre AS runtime
ARG JAR
WORKDIR /app
COPY --from=build /src/target/${JAR} /app/app.jar
# O perfil offline le ./calculadora/db/calculadora-pro.db (volume montado somente leitura).
ENV SPRING_PROFILES_ACTIVE=offline
RUN useradd -r -u 10001 app && mkdir -p /app/calculadora/db && chown -R app /app
USER app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
