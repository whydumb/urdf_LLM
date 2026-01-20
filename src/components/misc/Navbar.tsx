"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRobot } from "@/hooks/useRobot";
import type { ExampleRobot } from "@/types/robot";
import RobotCard from "@/components/controls/RobotCard";

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [examples, setExamples] = useState<ExampleRobot[]>([]);
  const {
    activeRobotOwner,
    activeRobotName,
    setActiveRobotOwner,
    setActiveRobotName,
    setActiveRobotType,
  } = useRobot();

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const res = await fetch("/example_robots.json", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load example_robots.json");
        const data = (await res.json()) as ExampleRobot[];
        if (isMounted) setExamples(data);
      } catch {
        console.error("Failed to load example robots");
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleExampleClick = (example: ExampleRobot) => {
    if (example.fileType === "URDF" && example.path) {
      setActiveRobotType("URDF");
      setActiveRobotOwner(example.owner);
      setActiveRobotName(example.repo_name);
    } else if (example.fileType === "MJCF" && example.path) {
      setActiveRobotType("MJCF");
      setActiveRobotOwner(example.owner);
      setActiveRobotName(example.repo_name);
    } else if (example.fileType === "USD") {
      setActiveRobotType("USD");
      setActiveRobotOwner(example.owner);
      setActiveRobotName(example.repo_name);
    }
    setIsMenuOpen(false);
  };

  return (
    <nav className="relative w-full h-[8vh] min-h-[48px] flex items-center justify-start px-4 md:px-8 bg-[#FCF4DD] text-[#968612]">
      {/* Left side: Logo */}
      <div className="flex items-center gap-3 md:gap-6">
        <Link
          href="/"
          className="hover:-translate-y-1 hover:opacity-80 transition-all flex items-center gap-2 group"
          aria-label="Home"
        >
          <Image
            src="/favicon.png"
            alt="Placeholder Logo"
            className="w-8 h-8 group-hover:scale-110 transition-transform"
            width={128}
            height={128}
          />
        </Link>
      </div>

      {/* Mobile: Hamburger to the right of the logo */}
      <button
        className="ml-3 inline-flex items-center justify-center rounded-md p-2 lg:hidden hover:bg-[#FFF2BF] focus:outline-none"
        aria-label="Open robot menu"
        onClick={() => setIsMenuOpen((v) => !v)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
          />
        </svg>
      </button>

      {/* Mobile: Right-side icons only */}
      <div className="ml-auto flex items-center gap-4 md:hidden">
        <a
          href="https://github.com/jurmy24/mechaverse"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:-translate-y-1 transition-transform flex items-center gap-2 group"
          aria-label="GitHub"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            className="w-5 h-5 group-hover:scale-110 transition-transform"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
        </a>
        <a
          href="https://discord.gg/UDYNE7qRVb"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:-translate-y-1 transition-transform flex items-center gap-2 group"
          aria-label="Discord"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            className="w-5 h-5 group-hover:scale-110 transition-transform"
          >
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" />
          </svg>
        </a>
      </div>

      {/* Desktop: Right-side links */}
      <div className="ml-auto hidden md:flex items-center gap-6">
        <a
          href="https://github.com/jurmy24/mechaverse"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:-translate-y-1 transition-transform flex items-center gap-2 group"
          aria-label="GitHub"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            className="w-5 h-5 group-hover:scale-110 transition-transform"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          <span className="text-base font-medium tracking-wide font-geist-mono">
            GitHub
          </span>
        </a>
        <a
          href="https://discord.gg/UDYNE7qRVb"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:-translate-y-1 transition-transform flex items-center gap-2 group"
          aria-label="Discord"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            className="w-5 h-5 group-hover:scale-110 transition-transform"
          >
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" />
          </svg>
          <span className="text-base font-medium tracking-wide font-geist-mono">
            Discord
          </span>
        </a>
      </div>

      {/* Mobile dropdown panel */}
      {isMenuOpen && (
        <div className="lg:hidden absolute top-full left-2 z-50 w-[88vw] max-w-sm bg-[#FFFBF1] border border-[#E9DFB5] rounded-xl shadow-lg p-3 max-h-[70vh] overflow-y-auto">
          <div className="flex flex-col gap-2">
            {examples.map((example, index) => {
              const isSelected =
                activeRobotOwner === example.owner &&
                activeRobotName === example.repo_name;
              return (
                <RobotCard
                  key={index}
                  index={index}
                  example={example}
                  isSelected={!!isSelected}
                  handleExampleClick={handleExampleClick}
                  compact
                />
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
