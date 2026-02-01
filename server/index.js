import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/output', express.static(path.join(__dirname, 'output')));

// Ensure output directory exists
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// ============================================
// EDGE TTS - FREE Text-to-Speech
// ============================================
app.post('/api/tts', async (req, res) => {
    const { text, voice = 'en-US-ChristopherNeural' } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required' });
    }

    const timestamp = Date.now();
    const audioFile = path.join(outputDir, `voiceover_${timestamp}.mp3`);

    try {
        // Use edge-tts CLI (Python package) via python module to ensure it works on Windows
        await new Promise((resolve, reject) => {
            // Use 'python -m edge_tts' to avoid PATH issues
            const process = spawn('python', [
                '-m', 'edge_tts',
                '--voice', voice,
                '--text', text,
                '--write-media', audioFile
            ]);

            process.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`edge-tts exited with code ${code}`));
            });

            process.on('error', reject);
        });

        res.json({
            success: true,
            audioUrl: `/output/voiceover_${timestamp}.mp3`,
            filename: `voiceover_${timestamp}.mp3`
        });

    } catch (error) {
        console.error('TTS Error:', error);
        res.status(500).json({ error: 'Failed to generate audio. Make sure edge-tts is installed: pip install edge-tts' });
    }
});

// Get available voices
app.get('/api/tts/voices', async (req, res) => {
    try {
        const voices = await new Promise((resolve, reject) => {
            let output = '';
            const process = spawn('python', ['-m', 'edge_tts', '--list-voices']);

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.on('close', () => {
                const voiceList = output.split('\n')
                    .filter(line => line.includes('Name:'))
                    .map(line => line.replace('Name: ', '').trim());
                resolve(voiceList);
            });

            process.on('error', reject);
        });

        res.json({ voices });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get voices' });
    }
});

// ============================================
// FFMPEG - Video Assembly
// ============================================
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

// Set ffmpeg path
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

app.post('/api/assemble', async (req, res) => {
    const { videoUrl, audioFile, subtitles, title } = req.body;

    if (!videoUrl || !audioFile) {
        return res.status(400).json({ error: 'Video URL and audio file are required' });
    }

    const timestamp = Date.now();
    const outputFile = path.join(outputDir, `final_${timestamp}.mp4`);
    const tempVideoFile = path.join(outputDir, `temp_video_${timestamp}.mp4`);
    const srtFile = path.join(outputDir, `subtitles_${timestamp}.srt`);

    try {
        // 1. Download the video from Pexels
        console.log('Downloading video...');
        const videoResponse = await fetch(videoUrl);
        const videoBuffer = await videoResponse.arrayBuffer();
        fs.writeFileSync(tempVideoFile, Buffer.from(videoBuffer));

        // 2. Create SRT file from subtitles
        if (subtitles && subtitles.length > 0) {
            const srtContent = generateSRT(subtitles);
            fs.writeFileSync(srtFile, srtContent);
        }

        // 3. Use FFmpeg to merge video + audio + subtitles
        console.log('Assembling video...');
        const audioPath = path.join(__dirname, audioFile.replace('/output/', 'output/'));

        await new Promise((resolve, reject) => {
            let command = ffmpeg(tempVideoFile)
                .input(audioPath)
                .outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-map 0:v:0',
                    '-map 1:a:0',
                    '-shortest',
                    '-y' // Overwrite output files without asking
                ]);

            // Add subtitles if available
            // Note: subtitles filter requires escaping slightly differently in fluent-ffmpeg
            if (fs.existsSync(srtFile)) {
                // Path needs to be properly escaped for Windows filter string
                const escapedSrtPath = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
                command = command.videoFilters(
                    `subtitles='${escapedSrtPath}':force_style='FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Alignment=2'`
                );
            }

            command
                .on('start', (cmdLine) => console.log('Spawned Ffmpeg with command: ' + cmdLine))
                .on('error', (err) => {
                    console.error('An error occurred: ' + err.message);
                    reject(err);
                })
                .on('end', () => {
                    console.log('Processing finished !');
                    resolve(null);
                })
                .save(outputFile);
        });

        // Cleanup temp files
        if (fs.existsSync(tempVideoFile)) fs.unlinkSync(tempVideoFile);
        if (fs.existsSync(srtFile)) fs.unlinkSync(srtFile);

        res.json({
            success: true,
            videoUrl: `/output/final_${timestamp}.mp4`,
            filename: `final_${timestamp}.mp4`
        });

    } catch (error) {
        console.error('Assembly Error:', error);
        res.status(500).json({ error: 'Failed to assemble video.' });
    }
});

// Generate SRT format from subtitles array
function generateSRT(subtitles) {
    let srt = '';
    const wordsPerSecond = 2.5; // Approximate speaking rate
    let currentTime = 0;

    subtitles.forEach((line, index) => {
        const wordCount = line.split(' ').length;
        const duration = wordCount / wordsPerSecond;
        const startTime = formatSRTTime(currentTime);
        const endTime = formatSRTTime(currentTime + duration);

        srt += `${index + 1}\n`;
        srt += `${startTime} --> ${endTime}\n`;
        srt += `${line}\n\n`;

        currentTime += duration;
    });

    return srt;
}

function formatSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// ============================================
// YOUTUBE UPLOAD
// ============================================
import { google } from 'googleapis';
import open from 'open';
import readline from 'readline';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const TOKEN_PATH = path.join(__dirname, 'tokens.json');

app.post('/api/youtube/upload', async (req, res) => {
    const { videoUrl, title, description, tags } = req.body;

    if (!videoUrl || !title) {
        return res.status(400).json({ error: 'Video URL and title are required' });
    }

    // Check if client_secret.json exists in root
    const CREDENTIALS_PATH = path.join(process.cwd(), 'client_secret.json');
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        return res.status(500).json({
            error: 'Missing client_secret.json',
            details: 'Please download OAuth 2.0 Client Credentials from Google Cloud Console, rename to client_secret.json, and place in project root.'
        });
    }

    try {
        const content = fs.readFileSync(CREDENTIALS_PATH);
        const credentials = JSON.parse(content);
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000');

        // Check for stored tokens
        if (fs.existsSync(TOKEN_PATH)) {
            const token = fs.readFileSync(TOKEN_PATH);
            oAuth2Client.setCredentials(JSON.parse(token));
        } else {
            // If no tokens, we can't upload automatically without user interaction via CLI/Browser on server side
            // For this demo, we'll return a special status indicating auth is needed
            // But to keep it simple for the user, let's try to handle it if running locally
            return res.status(401).json({
                error: 'Authentication Required',
                authUrl: oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES })
            });
        }

        // Prepare video file path
        // videoUrl is likely "/output/final_..."
        const videoFilename = videoUrl.split('/').pop();
        const videoPath = path.join(outputDir, videoFilename);

        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({ error: 'Video file not found on server' });
        }

        console.log(`Uploading ${videoFilename} to YouTube...`);

        const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

        const response = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title: title.substring(0, 100), // Max 100 chars
                    description: description,
                    tags: tags,
                    categoryId: '22', // People & Blogs
                },
                status: {
                    privacyStatus: 'private', // Start as private for safety
                    selfDeclaredMadeForKids: false,
                },
            },
            media: {
                body: fs.createReadStream(videoPath),
            },
        });

        console.log('Upload complete!');

        res.json({
            success: true,
            videoId: response.data.id,
            videoUrl: `https://youtube.com/shorts/${response.data.id}`
        });

    } catch (error) {
        console.error('YouTube Upload Error:', error);
        res.status(500).json({ error: 'Failed to upload to YouTube', details: error.message });
    }
});

// Endpoint to save tokens after manual auth (if we implement a frontend callback)
app.post('/api/youtube/auth-callback', async (req, res) => {
    const { code } = req.body;
    // Verify credentials again to get client (redundant but safe)
    const CREDENTIALS_PATH = path.join(process.cwd(), 'client_secret.json');
    const content = fs.readFileSync(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    const { client_secret, client_id } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000'); // Redirect URI must match console

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        res.json({ success: true, message: 'Authentication successful! You can now upload.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve access token' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           ViralShorts Backend Server Running!              ║
╠════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                                ║
║  TTS Endpoint: POST /api/tts                               ║
║  Assembly Endpoint: POST /api/assemble                     ║
║  YouTube Endpoint: POST /api/youtube/upload                ║
╚════════════════════════════════════════════════════════════╝
  `);
});
