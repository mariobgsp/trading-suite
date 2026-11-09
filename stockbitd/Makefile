BINARY ?= bin/stockbitd
GO ?= go

.PHONY: build test vet fmt run install uninstall clean

build:
	$(GO) build -trimpath -ldflags "-s -w" -o $(BINARY) ./cmd/stockbitd

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

fmt:
	gofmt -w cmd internal

run: build
	./$(BINARY) serve --open

install: build
	./install.sh

uninstall:
	./uninstall.sh

clean:
	rm -rf bin
