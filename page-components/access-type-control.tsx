import {
  useContext,
  useRef,
  useState,
  KeyboardEvent,
  useCallback,
} from "react";
import styles from "../styles/Home.module.css";
import urlContext, {
  SELECTION_TYPE,
  AccessTypeContext,
} from "../contexts/access-context";
import { TYPED_DATA_MODE } from "./typed-data";
import Toggle, { TOGGLE_STATUS } from "../components/toggle";

const URL_REGEX =
  /[(http(s)?):\/\/(www\.)?a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/i;

const UrlInput = ({ onEnter }: { onEnter: Function }) => {
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (URL_REGEX.test(inputRef.current?.value ?? "")) {
        onEnter(inputRef.current?.value || null);
        setError("");
      } else {
        setError("URL is invalid");
      }
    }
    return;
  };

  return (
    <div className={styles.urlContainer}>
      <input type="text" name="url" ref={inputRef} onKeyDown={onKeyDown} />
      {error && <div className={styles.urlError}>{error}</div>}
      <div className={styles.urlKey}>
        <span>Press</span>
        <kbd>&#x23CE;</kbd>
      </div>
    </div>
  );
};

const HTML_REGEX = /.{3,}/i;

const HTMLInput = ({ onEnter }: { onEnter: Function }) => {
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (HTML_REGEX.test(textareaRef.current?.value ?? "")) {
        onEnter(textareaRef.current?.value || null);
        setError("");
      } else {
        setError("HTML length should be greater than 3");
      }
    }
    return;
  };

  return (
    <div className={styles.urlContainer}>
      <textarea name="html" ref={textareaRef} onKeyDown={onKeyDown} />
      {error && <div className={styles.urlError}>{error}</div>}
      <div className={styles.urlKey}>
        <span>Press</span>
        <kbd>&#x23CE;</kbd>
      </div>
    </div>
  );
};

const AccessTypeControl = () => {
  const [accessData, setAccessData]: AccessTypeContext = useContext(urlContext);

  const onDataEnter = (data: string | null) => {
    setAccessData(data, TYPED_DATA_MODE.DATA);
  };

  const onToggleTypeMode = useCallback(() => {
    setAccessData(
      accessData.type === SELECTION_TYPE.HTML
        ? SELECTION_TYPE.URL
        : SELECTION_TYPE.HTML,
      TYPED_DATA_MODE.TYPE
    );
  }, [accessData.type]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <Toggle
        status={
          accessData.type === SELECTION_TYPE.HTML
            ? TOGGLE_STATUS.ON
            : TOGGLE_STATUS.OFF
        }
        onClick={onToggleTypeMode}
      />
      {accessData.type === SELECTION_TYPE.HTML ? (
        <HTMLInput onEnter={onDataEnter} />
      ) : (
        <UrlInput onEnter={onDataEnter} />
      )}
    </div>
  );
};

export default AccessTypeControl;
