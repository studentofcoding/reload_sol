import { FC, useContext } from "react";
import Link from "next/link";
import ConnectButton from "@/components/ConnectButton";
import UserContext from "@/contexts/usercontext";

const Header: FC = () => {
  const { tokeBalance } = useContext<any>(UserContext);

  return (
    <header className="w-full h-20 flex flex-row items-center border-b-[1px] border-[#26c3ff] shadow-xl shadow-[#193975]">
      <div className="container">
        <div className="flex items-center gap-2 ord-connect-font justify-end">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
};

export default Header;
