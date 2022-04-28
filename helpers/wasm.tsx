class WasmHelper {
  static module: any;
  static loadWasm() {
    import("../wasm/pkg/index.js").then(response => {
      WasmHelper.module = response;
    });
  };
}

export default WasmHelper;