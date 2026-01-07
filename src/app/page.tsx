"use client";

import { useState } from "react";

// Contexts
import { RobotProvider } from "@/contexts/RobotContext";
import { ExampleRobotsProvider } from "@/contexts/ExampleRobotsContext";

// Components
import Navbar from "@/components/misc/Navbar";
import ViewerControls from "@/components/controls/ViewerControls";
import ViewerSwitch from "@/components/viewer/ViewerSwitch";
import FullScreenDragDrop from "@/components/FullScreenDragDrop";
import ChatWidget from "@/components/chat/ChatWidget";

export default function Home() {
  const [showFullScreenDragDrop, setShowFullScreenDragDrop] = useState(false);

  return (
    <ExampleRobotsProvider>
      <RobotProvider>
        <div className="relative flex h-screen w-full flex-col">
          {/* Navbar (now inside providers to allow mobile robot menu) */}
          <Navbar />
          {/* Main content area */}
          <main className="flex flex-1 w-full min-h-0 bg-[#FCF4DD] p-6">
            <div className="flex flex-row w-full h-full gap-6">
              {/* Robot Selector section - hidden on mobile */}
              <div className="hidden lg:block lg:flex-[2] min-w-0 w-full h-full bg-[#FFFBF1] rounded-3xl overflow-hidden">
                <ViewerControls
                  onUploadClick={() => setShowFullScreenDragDrop(true)}
                />
              </div>
              {/* Viewer section - fills available space, but only ~80% height on mobile */}
              <div
                className="flex-4 min-w-0 flex items-center justify-center bg-[#fef4da] rounded-3xl overflow-hidden
                md:h-full h-[80vh]"
              >
                <ViewerSwitch />
              </div>
            </div>
          </main>

          {/* Full Screen Drag Drop Overlay */}
          {showFullScreenDragDrop && (
            <div className="absolute inset-0 h-[80vh]">
              <FullScreenDragDrop
                onClose={() => setShowFullScreenDragDrop(false)}
              />
            </div>
          )}

          <ChatWidget />
        </div>
      </RobotProvider>
    </ExampleRobotsProvider>
  );
}
