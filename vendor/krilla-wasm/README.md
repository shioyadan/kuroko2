# krilla-svg browser WASM

`pkg/` and the Rust wrapper were copied unchanged from `../kuroko2-mock/krilla-wasm`.
The checked-in binary uses krilla-svg 0.8.1 / krilla 0.8.2; `Cargo.lock` records its
dependencies. No Rust toolchain is required to build the HTML application.

To rebuild with a Rust toolchain supporting the locked crates:

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked --release --target wasm32-unknown-unknown
# Use the wasm-bindgen CLI version recorded for wasm-bindgen in Cargo.lock.
wasm-bindgen --target web --out-dir pkg --out-name krilla_svg_wasm \
  target/wasm32-unknown-unknown/release/krilla_svg_wasm_poc.wasm
```

The application calls `initSync` with inlined bytes in a dedicated Worker. It never
uses the generated loader's default file-fetching initialization path. Font files
are supplied by the user, not bundled. Notices for the locked crate sources are
included in the repository's `THIRD_PARTY_LICENSES.md` and distribution HTML.
