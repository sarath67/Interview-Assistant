/* eslint-disable @typescript-eslint/no-unused-vars */
import { useAuth } from "@clerk/clerk-react";
import {
  CircleStop,
  Loader,
  Mic,
  RefreshCw,
  Save,
  Video,
  VideoOff,
  WebcamIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import useSpeechToText, { ResultType } from "react-hook-speech-to-text";
import { useParams } from "react-router-dom";
import WebCam from "react-webcam";
import { TooltipButton } from "./tooltip-button";
import { toast } from "sonner";
import { chatSession } from "@/scripts";
import { SaveModal } from "./save-modal";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase.config";

interface RecordAnswerProps {
  question: { question: string; answer: string };
  isWebCam: boolean;
  setIsWebCam: (value: boolean) => void;
}

interface AIResponse {
  ratings: number;
  feedback: string;
}

export const RecordAnswer = ({
  question,
  isWebCam,
  setIsWebCam,
}: RecordAnswerProps) => {
  const {
    interimResult,
    isRecording,
    results,
    startSpeechToText,
    stopSpeechToText,
  } = useSpeechToText({
    continuous: true,
    useLegacyResults: false,
  });

  const [userAnswer, setUserAnswer] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const { userId } = useAuth();
  const { interviewId } = useParams();

  const recordUserAnswer = async () => {
    if (isRecording) {
      stopSpeechToText();

      

      // Generate AI result
      try {
        const aiResult = await generateResult(
          question.question,
          question.answer,
          userAnswer
        );
        setAiResult(aiResult);
      } catch (error) {
        console.error("Error generating AI result:", error);
        toast.error("Error", {
          description: "Failed to generate feedback. Please try again.",
        });
      }
    } else {
      startSpeechToText();
      toast.info("Recording started", {
        description: "Speak clearly into your microphone",
      });
    }
  };

  const cleanJsonResponse = (responseText: string) => {
    try {
      // First try to parse directly in case it's already valid JSON
      return JSON.parse(responseText);
    } catch (firstError) {
      try {
        // Remove markdown code block syntax and try again
        const cleanText = responseText.replace(/```json|```|`/g, '').trim();
        return JSON.parse(cleanText);
      } catch (secondError) {
        try {
          // Try to extract just the JSON object using regex
          const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
          throw new Error("Could not extract valid JSON");
        } catch (finalError) {
          console.error("JSON parsing failed:", responseText);
          throw new Error("Invalid JSON format: " + (finalError as Error)?.message);
        }
      }
    }
  };

  const generateResult = async (
    qst: string,
    qstAns: string,
    userAns: string
  ): Promise<AIResponse> => {
    setIsAiGenerating(true);
    const prompt = `
      Question: "${qst}"
      User Answer: "${userAns}"
      Correct Answer: "${qstAns}"
      Please compare the user's answer to the correct answer, and provide a rating (from 1 to 10) based on answer quality, and offer feedback for improvement.
      Return the result in JSON format with ONLY the fields "ratings" (number) and "feedback" (string).
      The response should be valid JSON without code block formatting.
    `;

    try {
      const aiResult = await chatSession.sendMessage(prompt);
      console.log("Raw AI response:", aiResult.response.text());
      
      const parsedResult = cleanJsonResponse(aiResult.response.text());
      
      // Validate the response structure
      if (typeof parsedResult?.ratings !== 'number' || typeof parsedResult?.feedback !== 'string') {
        throw new Error("Invalid response structure");
      }
      
      return parsedResult as AIResponse;
    } catch (error) {
      console.error("AI generation error:", error);
      toast.error("Error", {
        description: "An error occurred while generating feedback.",
      });
      throw error;
    } finally {
      setIsAiGenerating(false);
    }
  };

  const recordNewAnswer = () => {
    if (isRecording) {
      stopSpeechToText();
    }
    setUserAnswer("");
    setAiResult(null);
    setTimeout(() => {
      startSpeechToText();
      toast.info("Recording new answer", {
        description: "Previous answer has been cleared",
      });
    }, 300);
  };

  const saveUserAnswer = async () => {
    if (!aiResult) {
      toast.error("Error", {
        description: "No feedback available to save",
      });
      return;
    }

    setLoading(true);
    const currentQuestion = question.question;
    
    try {
      // Check if the user already answered this question
      const userAnswerQuery = query(
        collection(db, "userAnswers"),
        where("userId", "==", userId),
        where("question", "==", currentQuestion),
        where("mockIdRef", "==", interviewId)
      );

      const querySnap = await getDocs(userAnswerQuery);

      if (!querySnap.empty) {
        toast.info("Already Answered", {
          description: "You have already answered this question",
        });
      } else {
        // Save the user answer
        await addDoc(collection(db, "userAnswers"), {
          mockIdRef: interviewId,
          question: question.question,
          correct_ans: question.answer,
          user_ans: userAnswer,
          feedback: aiResult.feedback,
          rating: aiResult.ratings,
          userId,
          createdAt: serverTimestamp(),
        });

        toast.success("Saved", { 
          description: "Your answer has been saved successfully" 
        });
        
        // Reset state after saving
        setUserAnswer("");
        setAiResult(null);
        if (isRecording) {
          stopSpeechToText();
        }
      }
    } catch (error) {
      console.error("Error saving answer:", error);
      toast.error("Error", {
        description: "An error occurred while saving your answer.",
      });
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  useEffect(() => {
    // Combine transcripts from speech recognition results
    if (results.length > 0) {
      const combineTranscripts = results
        .filter((result): result is ResultType => typeof result !== "string")
        .map((result) => result.transcript)
        .join(" ");

      setUserAnswer(combineTranscripts);
    }
  }, [results]);

  // Display the AI feedback if available
  const renderFeedback = () => {
    if (!aiResult) return null;
    
    return (
      <div className="mt-4 p-4 border rounded-md bg-white">
        <h2 className="text-lg font-semibold">AI Feedback:</h2>
        <div className="flex items-center mt-2">
          <span className="font-medium mr-2">Rating:</span>
          <span className={`px-2 py-1 rounded ${
            aiResult.ratings >= 7 ? 'bg-green-100 text-green-800' : 
            aiResult.ratings >= 4 ? 'bg-yellow-100 text-yellow-800' : 
            'bg-red-100 text-red-800'
          }`}>
            {aiResult.ratings}/10
          </span>
        </div>
        <div className="mt-3">
          <span className="font-medium">Feedback:</span>
          <p className="text-sm mt-1 text-gray-700">{aiResult.feedback}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col items-center gap-6 mt-4">
      {/* Save modal */}
      <SaveModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={saveUserAnswer}
        loading={loading}
      />

      {/* Webcam container */}
      <div className="w-full h-[400px] md:w-96 flex flex-col items-center justify-center border p-4 bg-gray-50 rounded-md">
        {isWebCam ? (
          <WebCam
            onUserMedia={() => setIsWebCam(true)}
            onUserMediaError={() => setIsWebCam(false)}
            className="w-full h-full object-cover rounded-md"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <WebcamIcon className="w-24 h-24 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Camera is off</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        <TooltipButton
          content={isWebCam ? "Turn Off Camera" : "Turn On Camera"}
          icon={
            isWebCam ? (
              <VideoOff className="w-5 h-5" />
            ) : (
              <Video className="w-5 h-5" />
            )
          }
          onClick={() => setIsWebCam(!isWebCam)}
        />

        <TooltipButton
          content={isRecording ? "Stop Recording" : "Start Recording"}
          icon={
            isRecording ? (
              <CircleStop className="w-5 h-5 text-red-500" />
            ) : (
              <Mic className="w-5 h-5" />
            )
          }
          onClick={recordUserAnswer}
        />

        <TooltipButton
          content="Record New Answer"
          icon={<RefreshCw className="w-5 h-5" />}
          onClick={recordNewAnswer}
          disbaled={isAiGenerating}
        />

        <TooltipButton
          content="Save Result"
          icon={
            isAiGenerating ? (
              <Loader className="w-5 h-5 animate-spin" />
            ) : (
              <Save className="w-5 h-5" />
            )
          }
          onClick={() => setOpen(true)}
          disbaled={!aiResult || isAiGenerating}
        />
      </div>

      {/* User Answer */}
      <div className="w-full p-4 border rounded-md bg-gray-50">
        <h2 className="text-lg font-semibold">Your Answer:</h2>

        <p className="text-sm mt-2 text-gray-700 whitespace-normal">
          {userAnswer || "Start recording to see your answer here"}
        </p>

        {isRecording && interimResult && (
          <p className="text-sm text-gray-500 mt-2">
            <strong>Current Speech:</strong> {interimResult}
          </p>
        )}
      </div>

      {/* AI Feedback */}
      {renderFeedback()}
    </div>
  );
};