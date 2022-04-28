import { createContext } from "react";
import Noop from "../helpers/noop";

export enum SELECTION_TYPE {
  HTML,
  URL,
}

export type Access = {
  type: SELECTION_TYPE;
  data: string | null;
};

export type AccessTypeContext = [Access, Function];

export const DefaultAccessContextValue: Access = { type: SELECTION_TYPE.URL, data: null };

export default createContext<AccessTypeContext>([
  DefaultAccessContextValue,
  Noop.fn,
]);