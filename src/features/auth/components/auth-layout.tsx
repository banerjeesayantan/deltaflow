import Image from "next/image";
import Link from "next/link";

export const AuthLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="bg-muted flex min-h-svh flex-col justify-center items-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex justify-center self-center">
          <Image
            src="/logos/logo.svg"
            alt="DeltaFlow"
            width={200}
            height={47}
            className="rounded-md"
          />
        </Link>
        {children}
      </div>
    </div>
  );
};
