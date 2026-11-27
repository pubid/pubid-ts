// The CompiledWasm module import shape (wrangler
// `rules = [{ type = "CompiledWasm", ... }]`): the bundler resolves a
// .wasm import to the workerd-compiled WebAssembly.Module.
declare module "*.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
