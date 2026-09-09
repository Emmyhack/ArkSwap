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

# CGO is off so the binaries run on a distroless/static base.
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/arkswap-indexer ./apps/indexer/cmd/indexer
RUN go build -trimpath -ldflags="-s -w" -o /out/arkswap-api     ./apps/api/cmd/api

# --- runtime bases -------------------------------------------------------
# No compiler or toolchain in the final images (llm.txt s52).
FROM alpine:3.20 AS runtime-base
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -u 10001 arkswap
USER 10001
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
