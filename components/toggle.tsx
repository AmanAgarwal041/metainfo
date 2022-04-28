import { ChangeEventHandler, MouseEventHandler } from "react";

export enum TOGGLE_STATUS {
  OFF,
  ON,
};

type ToggleType = {
  status: TOGGLE_STATUS,
  onClick: ChangeEventHandler,
};

const Toggle = ({ status, onClick }: ToggleType) => {
  return (
    <input type="checkbox" checked={status === TOGGLE_STATUS.ON} onChange={onClick} />
  );
};

export default Toggle;