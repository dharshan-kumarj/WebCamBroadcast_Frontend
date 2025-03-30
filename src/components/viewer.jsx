import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import './Viewer.css';

const Viewer = () => {
  const { streamId } = useParams();
  const [status, setStatus] = useState('Connecting to stream...');
  const [connected, setConnected] = useState(false);
  const [broadcasterFound, setBroadcasterFound] = useState(false);
  
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const viewerId = useRef(`viewer_${Math.random().toString(36).substring(2, 15)}`);
  
  // Connect to the stream when component mounts
  useEffect(() => {
    if (streamId) {
      connectToStream();
    } else {
      setStatus('Invalid stream ID');
    }
    
    // Clean up when component unmounts
    return () => {
      disconnectFromStream();
    };
  }, [streamId]);
  
  // Connect to the signaling server and set up WebRTC
  const connectToStream = async () => {
    try {
      // Configure ICE servers (STUN/TURN)
      const configuration = {
        iceServers: [
          { 
            urls: 'stun:stun.l.google.com:19302' 
          },
          // Add TURN servers for better NAT traversal in production
          // {
          //   urls: 'turn:your-turn-server.com:3478',
          //   username: 'username',
          //   credential: 'password'
          // }
        ]
      };
      
      // Create RTCPeerConnection
      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;
      
      // Set up event handlers for the peer connection
      setupPeerConnectionEventHandlers(peerConnection);
      
      // Connect to signaling server
      const socket = new WebSocket(`ws://localhost:8000/ws/webrtc/${streamId}/`);
      socketRef.current = socket;
      
      socket.onopen = () => {
        console.log('Connected to signaling server');
        setStatus('Connected to signaling server, looking for broadcast...');
        
        // Announce presence as viewer
        socket.send(JSON.stringify({
          type: 'viewer_joined',
          viewerId: viewerId.current
        }));
      };
      
      socket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'broadcaster_ready') {
            setBroadcasterFound(true);
            setStatus('Broadcaster found, connecting...');
          }
          else if (message.type === 'offer' && message.viewerId === viewerId.current) {
            setBroadcasterFound(true);
            setStatus('Received offer from broadcaster, establishing connection...');
            
            const broadcasterId = message.broadcasterId;
            
            // Set the remote description from the offer
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
            
            // Create and send an answer
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.send(JSON.stringify({
              type: 'answer',
              answer: answer,
              broadcasterId: broadcasterId,
              viewerId: viewerId.current
            }));
          }
          else if (message.type === 'ice_candidate' && message.viewerId === viewerId.current) {
            try {
              // Add the ICE candidate from the broadcaster
              await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
            } catch (error) {
              console.error('Error adding received ice candidate', error);
            }
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
        }
      };
      
      socket.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.code}`);
        setStatus('Connection to stream closed');
        setBroadcasterFound(false);
        setConnected(false);
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('Connection error');
      };
    } catch (error) {
      console.error('Error connecting to stream:', error);
      setStatus(`Error: ${error.message}`);
    }
  };
  
  // Set up event handlers for the peer connection
  const setupPeerConnectionEventHandlers = (peerConnection) => {
    // When ICE candidates are generated, send them to the broadcaster
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'ice_candidate',
          candidate: event.candidate,
          broadcasterId: null, // This will be filled in by the signaling server
          viewerId: viewerId.current
        }));
      }
    };
    
    // When we receive a track, add it to the video element
    peerConnection.ontrack = (event) => {
      console.log('Received track from broadcaster');
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        setConnected(true);
        setStatus('Connected to broadcast');
      }
    };
    
    // Log connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state: ${peerConnection.iceConnectionState}`);
      
      if (peerConnection.iceConnectionState === 'disconnected' || 
          peerConnection.iceConnectionState === 'failed' ||
          peerConnection.iceConnectionState === 'closed') {
        
        setStatus('Connection lost');
        setConnected(false);
      }
    };
    
    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state: ${peerConnection.connectionState}`);
      
      if (peerConnection.connectionState === 'connected') {
        setStatus('Connected to broadcast');
        setConnected(true);
      } else if (peerConnection.connectionState === 'disconnected' || 
                peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'closed') {
        
        setStatus('Connection ended');
        setConnected(false);
      }
    };
  };
  
  // Disconnect from the stream
  const disconnectFromStream = () => {
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Close WebSocket connection
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'viewer_left',
          viewerId: viewerId.current
        }));
      }
      socketRef.current.close();
      socketRef.current = null;
    }
    
    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setConnected(false);
    setBroadcasterFound(false);
    setStatus('Disconnected from stream');
  };
  
  // Attempt to reconnect to the stream
  const handleReconnect = () => {
    disconnectFromStream();
    setTimeout(() => {
      connectToStream();
    }, 1000);
  };
  
  return (
    <div className="viewer-container">
      <h1>Live Stream Viewer</h1>
      
      <div className="stream-info">
        <p>Stream ID: <span className="highlight">{streamId}</span></p>
        <p>Status: <span className={`highlight ${connected ? 'active' : ''}`}>{status}</span></p>
      </div>
      
      <div className="video-container">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          controls
          style={{ display: connected ? 'block' : 'none' }}
        />
        
        {!connected && (
          <div className="placeholder">
            {!broadcasterFound ? (
              <div>
                <p>Waiting for broadcast to begin...</p>
                <div className="loading-spinner"></div>
              </div>
            ) : (
              <p>Establishing connection...</p>
            )}
          </div>
        )}
      </div>
      
      <div className="controls">
        <button 
          className="reconnect-button"
          onClick={handleReconnect}
        >
          Reconnect
        </button>
      </div>
      
      <div className="instructions">
        <h3>Viewing stream: {streamId}</h3>
        <p>If you're having trouble connecting:</p>
        <ul>
          <li>Check that the broadcaster has started the stream</li>
          <li>Try refreshing the page or clicking "Reconnect"</li>
          <li>Ensure you have the correct Stream ID</li>
        </ul>
      </div>
    </div>
  );
};

export default Viewer;