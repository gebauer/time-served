FROM alpine:3.20

ARG PB_VERSION=0.39.5

RUN apk add --no-cache ca-certificates unzip wget

RUN wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
    && unzip /tmp/pb.zip pocketbase -d /pb \
    && rm /tmp/pb.zip

COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY docker-entrypoint.sh /pb/entrypoint.sh
RUN chmod +x /pb/entrypoint.sh

WORKDIR /pb
EXPOSE 8090

ENTRYPOINT ["/pb/entrypoint.sh"]
