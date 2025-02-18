"use client"
import Header from "@/components/Header";
import Navbar from "@/components/Navbar";
import TextLoading from "@/components/TextLoading"
import LoadingModal from "@/components/LoadingModal";
import { useContext } from "react";
import UserContext from "@/contexts/usercontext";
import { ToastContainer } from "react-toastify";

export default function Home() {
  const { loadingState, textLoadingState } = useContext<any>(UserContext);

  return (
    <main className="w-full flex min-h-screen flex-col items-center justify-between bg-black harlow">
      <Header />
      <Navbar />
      {loadingState && <LoadingModal />}
      {textLoadingState && <TextLoading />}
      <ToastContainer style={{ fontSize: 14 }} />
    </main>
  );
}
