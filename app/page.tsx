"use client";

import clsx from "clsx";
import { useActionState, useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { EnterIcon, LoadingIcon, MicrophoneIcon, MicrophoneOffIcon, SettingsIcon } from "@/lib/icons";
import { usePlayer } from "@/lib/usePlayer";
import { track } from "@vercel/analytics";
import { useMicVAD, utils } from "@ricky0123/vad-react";
import Image from "next/image";

type Message = {
	role: "user" | "assistant";
	content: string;
	latency?: number;
};

export default function Home() {
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const player = usePlayer();
	const [isMuted, setIsMuted] = useState(false);
	const dotRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	const [document, setDocument] = useState("");
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	const vad = useMicVAD({
		startOnLoad: !isMuted,
		onSpeechEnd: (audio) => {
			player.stop();
			const wav = utils.encodeWAV(audio);
			const blob = new Blob([wav], { type: "audio/wav" });
			submit(blob);
			const isFirefox = navigator.userAgent.includes("Firefox");
			if (isFirefox) vad.pause();
		},
		workletURL: "/vad.worklet.bundle.min.js",
		modelURL: "/silero_vad.onnx",
		positiveSpeechThreshold: 0.6,
		minSpeechFrames: 4,
		ortConfig(ort) {
			const isSafari = /^((?!chrome|android).)*safari/i.test(
				navigator.userAgent
			);

			ort.env.wasm = {
				wasmPaths: {
					"ort-wasm-simd-threaded.wasm":
						"/ort-wasm-simd-threaded.wasm",
					"ort-wasm-simd.wasm": "/ort-wasm-simd.wasm",
					"ort-wasm.wasm": "/ort-wasm.wasm",
					"ort-wasm-threaded.wasm": "/ort-wasm-threaded.wasm",
				},
				numThreads: isSafari ? 1 : 4,
			};
		},
	});

	const toggleMute = useCallback(() => {
		setIsMuted((prev) => !prev);
		if (isMuted) {
			vad.start();
		} else {
			vad.pause();
		}
	}, [isMuted, vad]);

	useEffect(() => {
		function keyDown(e: KeyboardEvent) {
			if (e.key === "Enter") return inputRef.current?.focus();
			if (e.key === "Escape") return setInput("");
		}

		window.addEventListener("keydown", keyDown);
		return () => window.removeEventListener("keydown", keyDown);
	});

	useEffect(() => {
		if (!player.isPlaying || !dotRef.current) return;

		let animationFrameId: number;

		const updateSize = () => {
			if (player.isPlaying) {
				const analyser = player.getAnalyser();
				if (analyser) {
					const dataArray = new Uint8Array(analyser.frequencyBinCount);
					analyser.getByteFrequencyData(dataArray);
					const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
					const newScale = 1 + (average / 128) * 0.5; // Reduced scaling factor
					setScale(newScale);
				}
				animationFrameId = requestAnimationFrame(updateSize);
			} else {
				setScale(1);
			}
		};

		updateSize();

		return () => {
			if (animationFrameId) {
				cancelAnimationFrame(animationFrameId);
			}
			setScale(1);
		};
	}, [player.isPlaying]);

	const [messages, submit, isPending] = useActionState<
		Array<Message>,
		string | Blob
	>(async (prevMessages, data) => {
		const formData = new FormData();

		if (typeof data === "string") {
			formData.append("input", data);
			track("Text input");
		} else {
			formData.append("input", data, "audio.wav");
			track("Speech input");
		}

		for (const message of prevMessages) {
			formData.append("message", JSON.stringify(message));
		}
		
		if (document){
			formData.append("document", document);
		}

		const submittedAt = Date.now();

		const response = await fetch("/api", {
			method: "POST",
			body: formData,
		});

		const transcript = decodeURIComponent(
			response.headers.get("X-Transcript") || ""
		);
		const text = decodeURIComponent(
			response.headers.get("X-Response") || ""
		);

		if (!response.ok || !transcript || !text || !response.body) {
			if (response.status === 429) {
				toast.error("Too many requests. Please try again later.");
			} else {
				toast.error((await response.text()) || "An error occurred.");
			}

			return prevMessages;
		}

		const latency = Date.now() - submittedAt;
		player.play(response.body, () => {
			const isFirefox = navigator.userAgent.includes("Firefox");
			if (isFirefox) vad.start();
		});
		setInput(transcript);

		return [
			...prevMessages,
			{
				role: "user",
				content: transcript,
			},
			{
				role: "assistant",
				content: text,
				latency,
			},
		];
	}, []);

	const submitCallback = useCallback(async (data: string | Blob) => {
		const formData = new FormData();

		if (typeof data === "string") {
			formData.append("input", data);
			track("Text input");
		} else {
			formData.append("input", data, "audio.wav");
			track("Speech input");
		}

		for (const message of messages) {
			formData.append("message", JSON.stringify(message));
		}

		formData.append("document", document);

		const submittedAt = Date.now();

		const response = await fetch("/api", {
			method: "POST",
			body: formData,
		});

		const transcript = decodeURIComponent(
			response.headers.get("X-Transcript") || ""
		);
		const text = decodeURIComponent(
			response.headers.get("X-Response") || ""
		);

		if (!response.ok || !transcript || !text || !response.body) {
			if (response.status === 429) {
				toast.error("Too many requests. Please try again later.");
			} else {
				toast.error((await response.text()) || "An error occurred.");
			}

			return prevMessages;
		}

		const latency = Date.now() - submittedAt;
		player.play(response.body, () => {
			const isFirefox = navigator.userAgent.includes("Firefox");
			if (isFirefox) vad.start();
		});
		setInput(transcript);

		return [
			...prevMessages,
			{
				role: "user",
				content: transcript,
			},
			{
				role: "assistant",
				content: text,
				latency,
			},
		];
	}, [messages, document]);

	function handleFormSubmit(e: React.FormEvent) {
		e.preventDefault();
		submitCallback(input);
	}

	function handleDocumentSubmit(e: React.FormEvent) {
		e.preventDefault();
		setIsSettingsOpen(false);
	}

	return (
		<>


			<div className="pb-4 min-h-28" />


			<div className="relative flex justify-center items-center mb-2">
				<div 
					ref={dotRef}
					className="bg-[#F55036] h-12 w-12 rounded-full transition-transform duration-75"
					style={{ transform: `scale(${scale})` }}
				/>
			</div>

			<div className="text-neutral-400 dark:text-neutral-600 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4 mb-24">
					{messages.length > 0 && (
						<p>
							{messages.at(-1)?.content}
							<span className="text-xs font-mono text-neutral-300 dark:text-neutral-700">
								{" "}
								({messages.at(-1)?.latency}ms)
							</span>
						</p>
					)}

					{messages.length === 0 && (
						<>
							{vad.loading ? (
								<p>Loading speech detection...</p>
							) : vad.errored ? (
								<p>Failed to load speech detection.</p>
							) : (
								<p>Start talking to chat.</p>
							)}
						</>
					)}
			</div>


			<div className="justify-center items-center fixed bottom-6">
				<Image src="/powered-by-groq.svg" alt="Powered by Groq" width={275} height={50} />
			</div>


			<button
				type="button"
				onClick={toggleMute}
				className="fixed bottom-4 right-4 p-4 text-[#F55036] rounded-full"
				aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
			>
				{isMuted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
			</button>

			<button
				onClick={() => setIsSettingsOpen(true)}
				className="fixed bottom-4 left-4 p-4 text-[#F55036] rounded-full"
				aria-label="Open settings"
			>
				<SettingsIcon />
			</button>

			{isSettingsOpen && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-2xl w-full">
						<h2 className="text-2xl font-bold mb-4">Document</h2>
						<form onSubmit={handleDocumentSubmit}>
							<textarea
								value={document}
								onChange={(e) => setDocument(e.target.value)}
								placeholder="Enter your document here..."
								className="w-full h-64 p-2 border border-gray-300 dark:border-gray-700 rounded mb-4"
							/>
							<div className="flex justify-end">
								<button
									type="button"
									onClick={() => setIsSettingsOpen(false)}
									className="mr-2 px-4 py-2 text-gray-600 dark:text-gray-400"
								>
									Cancel
								</button>
								<button
									type="submit"
									className="px-4 py-2 bg-[#F55036] text-white rounded"
								>
									Save
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

		</>
	);
}

function A(props: any) {
	return (
		<a
			{...props}
			className="text-[#F55036] hover:underline font-medium"
		/>
	);
}
