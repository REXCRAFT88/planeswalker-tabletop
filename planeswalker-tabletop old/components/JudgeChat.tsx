import React, { useState, useRef, useEffect } from 'react';
import { askJudge } from '../services/gemini';
import { Send, Bot, X, MessageSquare, Loader } from 'lucide-react';

interface JudgeChatProps {
    isOpen: boolean;
    onClose: () => void;
}

export const JudgeChat: React.FC<JudgeChatProps> = ({ isOpen, onClose }) => {
    const [messages, setMessages] = useState<{role: 'user' | 'judge', text: string}[]>([
        { role: 'judge', text: "Hello! I am your AI Rules Judge. Ask me any question about Magic: The Gathering rules or interactions."}
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async () => {
        if (!input.trim() || loading) return;
        
        const question = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: question }]);
        setLoading(true);

        const answer = await askJudge(question);
        
        setMessages(prev => [...prev, { role: 'judge', text: answer }]);
        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed bottom-24 right-4 w-96 h-[500px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[99999]">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-900 to-indigo-900 p-4 flex items-center justify-between border-b border-gray-700">
                <div className="flex items-center gap-2 text-white font-semibold">
                    <Bot size={20} className="text-purple-300"/>
                    <span>Rules Judge</span>
                </div>
                <button onClick={onClose} className="text-gray-300 hover:text-white">
                    <X size={18} />
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-800/50">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-lg p-3 text-sm leading-relaxed ${
                            msg.role === 'user' 
                            ? 'bg-blue-600 text-white rounded-br-none' 
                            : 'bg-gray-700 text-gray-100 rounded-bl-none border border-gray-600'
                        }`}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-gray-700 rounded-lg p-3 rounded-bl-none flex items-center gap-2 text-gray-400 text-sm">
                            <Loader className="animate-spin" size={14}/>
                            <span>Consulting the Comprehensive Rules...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 bg-gray-900 border-t border-gray-700 flex gap-2">
                <input
                    type="text"
                    className="flex-1 bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                    placeholder="Ask a rules question..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />
                <button 
                    onClick={handleSend}
                    disabled={loading || !input.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white p-2 rounded-md transition-colors"
                >
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
};
