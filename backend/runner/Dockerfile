FROM eclipse-temurin:21-jdk-jammy
RUN groupadd --gid 10001 runner && useradd --uid 10001 --gid 10001 --no-create-home runner \
    && mkdir /classes && chown 10001:10001 /classes
COPY java-engine/lib/junit.jar /opt/junit.jar
RUN chmod 444 /opt/junit.jar
WORKDIR /classes
USER 10001:10001
CMD ["java", "-version"]
