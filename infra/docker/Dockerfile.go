# Multi-stage build for both Go binaries (llm.txt s52).
#
# One Dockerfile, two targets: the indexer and the API share every internal
# package, so building them separately would compile the same code twice.
# Select with --target=indexer or --target=api.

# --- build ---------------------------------------------------------------
FROM golang:1.27-alpine AS build
WORKDIR /src

RUN apk add --no-cache git

# The Go workspace spans three modules; copy the manifests first so dependency
# download is cached independently of source changes.
COPY go.work go.work.sum* ./
COPY packages/gointernal/go.mod packages/gointernal/go.sum ./packages/gointernal/
COPY apps/api/go.mod ./apps/api/
COPY apps/indexer/go.mod ./apps/indexer/
RUN go mod download all || true

COPY packages/gointernal ./packages/gointernal
COPY apps/api ./apps/api
COPY apps/indexer ./apps/indexer
# The deployment manifest is the canonical address record both binaries read.
COPY packages/addresses ./packages/addresses

# CGO is off and the timezone database is compiled in, so the binaries carry
# everything they need and the runtime image can be empty.
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -tags timetzdata -ldflags="-s -w" -o /out/arkswap-indexer ./apps/indexer/cmd/indexer
RUN go build -trimpath -tags timetzdata -ldflags="-s -w" -o /out/arkswap-api     ./apps/api/cmd/api

# The runtime image has no shell, so the unprivileged user is minted here.
RUN echo 'arkswap:x:10001:10001::/app:/sbin/nologin' > /out/passwd \
 && echo 'arkswap:x:10001:' > /out/group

# --- runtime bases -------------------------------------------------------
# Scratch: no compiler, no package manager, no shell (llm.txt s52). The binaries
# are static, so the only things the image needs are the CA bundle for TLS to
# the RPC endpoint and a passwd entry for the unprivileged user — both copied
# from the builder rather than installed, which also means the runtime stage
# fetches nothing at build time.
FROM scratch AS runtime-base
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/passwd /etc/passwd
COPY --from=build /out/group /etc/group
USER 10001:10001
WORKDIR /app
# Canonical addresses travel with the image so a container needs no bind mount.
COPY --from=build /src/packages/addresses /app/packages/addresses

FROM runtime-base AS indexer
COPY --from=build /out/arkswap-indexer /bin/arkswap-indexer
ENTRYPOINT ["/bin/arkswap-indexer"]

FROM runtime-base AS api
COPY --from=build /out/arkswap-api /bin/arkswap-api
EXPOSE 8080
ENTRYPOINT ["/bin/arkswap-api"]
