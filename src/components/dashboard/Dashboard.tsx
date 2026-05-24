'use client';

import { useState, useCallback } from 'react';
import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';
import CustomPlanModal from './CustomPlanModal';
import WorkoutSummaryModal from './WorkoutSummaryModal';
import { usePipeline } from '@/services/usePipeline';
import type { CoachPersonality } from '@/types/dashboard';

export default function Dashboard() {
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  const pipeline = usePipeline({
    onWorkoutEnd: () => setShowSummaryModal(true),
  });

  const {
    state,
    toggleSession,
    setMode,
    setExercise,
    setPersonality,
    setVoiceEnabled,
    startVoice,
    stopVoice,
  } = pipeline;

  const handleEndWorkout = useCallback(() => {
    toggleSession(); // stop
    setShowSummaryModal(true);
  }, [toggleSession]);

  return (
    <div className="h-screen w-screen bg-slate-950 text-white overflow-hidden flex">
      {/* Left Panel: 3D Monster + Controls */}
      <div className="w-[42%] flex-shrink-0 border-r border-slate-800/60">
        <LeftPanel
          exercise={state.exercise}
          personality={state.personality}
          isTraining={state.isTraining}
          currentAction={state.workout.currentAction}
          feedbackItems={state.feedback}
          mode={state.mode}
          reps={state.workout.reps}
          score={state.workout.score}
          onToggleSession={toggleSession}
          onSetExercise={setExercise}
          onSetPersonality={setPersonality}
          onSetMode={setMode}
          onOpenPlanModal={() => setShowPlanModal(true)}
          voiceEnabled={state.voiceEnabled}
          onToggleVoice={setVoiceEnabled}
          onStartVoice={startVoice}
          onStopVoice={stopVoice}
          isListening={state.isListening}
          voiceMessages={state.voiceMessages}
        />
      </div>

      {/* Right Panel: Camera / Stats / Feedback */}
      <div className="flex-1 min-w-0">
        <RightPanel
          workout={state.workout}
          biometrics={state.biometrics}
          environment={state.environment}
          connectionError={state.connectionError}
          onOpenPlanModal={() => setShowPlanModal(true)}
          onEndWorkout={handleEndWorkout}
          remoteFrameSrc={state.remoteFrameSrc}
          canvasRef={pipeline.canvasRef}
          videoRef={pipeline.videoRef}
        />
      </div>

      {/* Modals */}
      <CustomPlanModal
        open={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        personality={state.personality}
      />

      <WorkoutSummaryModal
        open={showSummaryModal}
        onClose={() => setShowSummaryModal(false)}
        workout={state.workout}
        biometrics={state.biometrics}
        personality={state.personality}
        durationSeconds={state.sessionDuration}
      />
    </div>
  );
}
