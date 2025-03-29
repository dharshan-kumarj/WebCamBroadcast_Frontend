import React, { useState, useEffect, useRef } from 'react';
import './Broadcaster.css';

const Broadcaster = () => {
  const [streamId, setStreamId] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState('Ready to stream');
  const [viewerCount, setViewerCount] = useState(0);
  const [fps, setFps] = useState(10); // Frames per second
  const [quality, setQuality] = useState(0.7); // JPEG quality (0-1)
  const [resolution, setResolution] = useState('640x480');
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const socketRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const broadcasterId = useRef(`broadcaster_${Math.random().toString(36).substring(2, 15)}`);
  const viewers = useRef(new Set());

  // Fetch a new stream ID when component mounts
  useEffect(() => {
    fetchStreamId();
    
    // Clean up when component unmounts
    return () => {
      stopStreaming();
    };
  }, []);
  
  // Fetch a stream ID from the server
  const fetchStreamId = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/get-stream-id/');
      const data = await response.json();
      setStreamId(data.stream_id);
    } catch (error) {
      console.error('Error fetching stream ID:', error);
      setStatus('Error fetching stream ID');
    }
  };
  
  // Start the broadcasting session
  const startStreaming = async () => {
    try {
      // Get video stream from camera
      streamRef.current = await navigator.mediaDevices.getUserMedia({ 
        video: getResolutionConstraints(), 
        audio: false 
      });
      
      // Set the video source
      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      
      // Setup WebSocket connection
      socketRef.current = new WebSocket(`ws://localhost:8000/ws/broadcast/${streamId}/`);
      
      socketRef.current.onopen = () => {
        console.log('WebSocket connection established for broadcasting');
        setStatus('Connected to server, streaming active');
        setIsStreaming(true);
        
        // Start sending frames once the connection is established
        startSendingFrames();
      };
      
      socketRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'viewer_update') {
            if (data.action === 'joined') {
              console.log(`Viewer joined: ${data.viewer_id}`);
              viewers.current.add(data.viewer_id);
              setViewerCount(viewers.current.size);
            } else if (data.action === 'left') {
              console.log(`Viewer left: ${data.viewer_id}`);
              viewers.current.delete(data.viewer_id);
              setViewerCount(viewers.current.size);
            }
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };
      
      socketRef.current.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.code}`);
        setStatus('Connection closed');
        setIsStreaming(false);
        stopSendingFrames();
      };
      
      socketRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('Connection error');
      };
    } catch (error) {
      console.error('Error starting stream:', error);
      setStatus(`Error: ${error.message}`);
    }
  };
  
  // Stop the broadcasting session
  const stopStreaming = () => {
    // Stop sending frames
    stopSendingFrames();
    
    // Close WebSocket connection
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    // Stop video stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Reset video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsStreaming(false);
    setStatus('Stream ended');
    setViewerCount(0);
    viewers.current.clear();
  };
  
  // Start sending video frames
  const startSendingFrames = () => {
    console.log(`Starting to send frames at ${fps} FPS with quality ${quality}`);
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const context = canvas.getContext('2d');
    
    // Calculate frame interval based on FPS
    const frameInterval = 1000 / fps;
    
    // Set canvas dimensions to match video
    if (video) {
      const [width, height] = resolution.split('x').map(Number);
      canvas.width = width;
      canvas.height = height;
    }
    
    // Function to capture and send a frame
    const captureAndSendFrame = () => {
      if (!video || !canvas || !context || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        console.log('Cannot send frame - video or WebSocket not ready');
        return;
      }
      
      try {
        // Draw the current video frame to the canvas
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Get the frame as a data URL
        const frameDataUrl = canvas.toDataURL('image/jpeg', quality);
        
        // Check frame size to avoid huge payloads
        const frameSize = frameDataUrl.length;
        
        if (frameSize > 100000) {
          console.warn(`Large frame size: ${(frameSize/1024).toFixed(1)}KB - consider reducing quality/resolution`);
        }
        
        // Send the frame through WebSocket
        socketRef.current.send(JSON.stringify({
          type: 'video_frame',
          frame: frameDataUrl,
          broadcaster_id: broadcasterId.current
        }));
        
      } catch (error) {
        console.error('Error sending frame:', error);
      }
    };
    
    // Start the frame sending interval
    frameIntervalRef.current = setInterval(captureAndSendFrame, frameInterval);
  };
  
  // Stop sending video frames
  const stopSendingFrames = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
  };
  
  // Get video constraints based on selected resolution
  const getResolutionConstraints = () => {
    const [width, height] = resolution.split('x').map(Number);
    return {
      width: { ideal: width },
      height: { ideal: height }
    };
  };
  
  // Handle quality change
  const handleQualityChange = (e) => {
    const newQuality = parseFloat(e.target.value);
    setQuality(newQuality);
    
    // Update frame sending if already streaming
    if (isStreaming) {
      stopSendingFrames();
      startSendingFrames();
    }
  };
  
  // Handle FPS change
  const handleFpsChange = (e) => {
    const newFps = parseInt(e.target.value, 10);
    setFps(newFps);
    
    // Update frame sending if already streaming
    if (isStreaming) {
      stopSendingFrames();
      startSendingFrames();
    }
  };
  
  // Handle resolution change
  const handleResolutionChange = (e) => {
    setResolution(e.target.value);
  };
  
  return (
    <div className="broadcaster-container">
      <h1>Live Video Broadcaster</h1>
      
      <div className="stream-info">
        <p>Stream ID: <span className="highlight">{streamId}</span></p>
        <p>Status: <span className={`highlight ${isStreaming ? 'active' : ''}`}>{status}</span></p>
        <p>Viewers: <span className="highlight">{viewerCount}</span></p>
      </div>
      
      <div className="video-container">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted
          style={{ display: isStreaming ? 'block' : 'none' }}
        />
        
        {!isStreaming && (
          <div className="placeholder">
            Camera preview will appear here when streaming starts
          </div>
        )}
        
        {/* Hidden canvas used for frame capture */}
        <canvas 
          ref={canvasRef} 
          style={{ display: 'none' }}
        />
      </div>
      
      <div className="settings-panel">
        <h3>Streaming Settings</h3>
        
        <div className="setting">
          <label>Resolution:</label>
          <select 
            value={resolution} 
            onChange={handleResolutionChange}
            disabled={isStreaming}
          >
            <option value="320x240">320x240 (Low)</option>
            <option value="640x480">640x480 (Medium)</option>
            <option value="1280x720">1280x720 (HD)</option>
          </select>
        </div>
        
        <div className="setting">
          <label>Quality: {quality.toFixed(1)}</label>
          <input 
            type="range" 
            min="0.1" 
            max="1" 
            step="0.1" 
            value={quality}
            onChange={handleQualityChange}
          />
        </div>
        
        <div className="setting">
          <label>FPS: {fps}</label>
          <input 
            type="range" 
            min="1" 
            max="30" 
            value={fps}
            onChange={handleFpsChange}
          />
        </div>
      </div>
      
      <div className="controls">
        {!isStreaming ? (
          <button 
            className="start-button"
            onClick={startStreaming}
          >
            Start Broadcasting
          </button>
        ) : (
          <button 
            className="stop-button"
            onClick={stopStreaming}
          >
            Stop Broadcasting
          </button>
        )}
        
        <button 
          className="new-id-button"
          onClick={fetchStreamId}
          disabled={isStreaming}
        >
          Generate New Stream ID
        </button>
      </div>
      
      <div className="instructions">
        <h3>How to use:</h3>
        <ol>
          <li>Share your Stream ID with viewers</li>
          <li>Click "Start Broadcasting" to begin</li>
          <li>Viewers can join at: http://localhost:5173/view/{streamId}</li>
        </ol>
      </div>
    </div>
  );
};

export default Broadcaster;