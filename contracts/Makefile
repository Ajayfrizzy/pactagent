TARGET ?= riscv64imac-unknown-none-elf
CONTRACT_BIN := pact_escrow_lock
TOOLCHAIN_PATH := /Users/oluwaseun/.rustup/toolchains/stable-aarch64-apple-darwin/bin
RUSTUP_PATH := /opt/homebrew/opt/rustup/bin
BREW_PATH := /opt/homebrew/bin
CARGO := $(TOOLCHAIN_PATH)/cargo
HOST_TARGET := $(shell $(TOOLCHAIN_PATH)/rustc -vV | sed -n 's/^host: //p')

export PATH := $(TOOLCHAIN_PATH):$(RUSTUP_PATH):$(BREW_PATH):$(PATH)
export CC_riscv64imac_unknown_none_elf := riscv64-elf-gcc

.PHONY: build test clean copy-binary

build:
	$(CARGO) build --manifest-path Cargo.toml --release --target $(TARGET) -p pact-escrow-lock
	mkdir -p build/release
	cp target/$(TARGET)/release/$(CONTRACT_BIN) build/release/$(CONTRACT_BIN)

test:
	$(CARGO) test --manifest-path Cargo.toml -p pact-escrow-lock --target $(HOST_TARGET) --lib

clean:
	$(CARGO) clean --manifest-path Cargo.toml
	rm -rf build/release/$(CONTRACT_BIN)
