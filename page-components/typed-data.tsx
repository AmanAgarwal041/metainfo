import { ReactChild, useState, useCallback } from "react";
import type { Access } from "../contexts/access-context";
import AccessContext, {
  DefaultAccessContextValue,
  SELECTION_TYPE,
} from "../contexts/access-context";
import WasmHelper from "../helpers/wasm";

export enum TYPED_DATA_MODE {
  DATA,
  TYPE,
}

const TYPED_WASM_MODE = {
  [SELECTION_TYPE.URL]: 1,
  [SELECTION_TYPE.HTML]: 2,
};

const TypedData = ({ children }: { children: ReactChild }) => {
  const [accessData, setAccessData] = useState<Access>(DefaultAccessContextValue);

  const setDataOnEnter = (
    data: string | null | SELECTION_TYPE,
    mode: TYPED_DATA_MODE
  ): void => {
    switch (mode) {
      case TYPED_DATA_MODE.DATA:
        setAccessData((prev) => ({ ...prev, data: data as string }));
        WasmHelper.module.run(data, TYPED_WASM_MODE[accessData.type]);
        break;
      case TYPED_DATA_MODE.TYPE:
        setAccessData({
          ...DefaultAccessContextValue,
          type: data as SELECTION_TYPE,
        });
        break;
      default:
        break;
    }
  };

  return (
    <AccessContext.Provider value={[accessData, setDataOnEnter]}>
      {children}
    </AccessContext.Provider>
  );
};

export default TypedData;
