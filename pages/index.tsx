import type { NextPage } from "next";
import { useEffect } from "react";
import Head from "next/head";
import styles from "../styles/Home.module.css";
import AccessTypeControl from "../page-components/access-type-control";
import WasmHelper from "../helpers/wasm";
import TypedData from "../page-components/typed-data";

const Home: NextPage = () => {
  useEffect(() => {
    WasmHelper.loadWasm();
  }, []);
  return (
    <TypedData>
      <div className={styles.container}>
        <Head>
          <title>Create Next App</title>
          <meta name="description" content="Generated by create next app" />
          <link rel="icon" href="/favicon.ico" />
        </Head>

        <header className={styles.header}>
          <h1 className={styles.title}>MetaInfo</h1>
          <AccessTypeControl />
        </header>

        <main className={styles.main}></main>
      </div>
    </TypedData>
  );
};

export default Home;
