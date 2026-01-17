import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, MessageSquare, Code } from "lucide-react";
import { ChatWidget } from "@/components/chat-widget";

export default function AdminChatPreview() {
  const { toast } = useToast();

  const embedCode = `<script src="${window.location.origin}/widget.js" defer></script>`;
  const iframeCode = `<iframe src="${window.location.origin}/chat" style="width: 400px; height: 600px; border: none; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);"></iframe>`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chat Widget</h1>
        <p className="text-muted-foreground">Preview and embed the AI chat widget on your website</p>
      </div>

      <Tabs defaultValue="preview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="preview" data-testid="tab-preview">
            <MessageSquare className="h-4 w-4 mr-2" />
            Preview
          </TabsTrigger>
          <TabsTrigger value="embed" data-testid="tab-embed">
            <Code className="h-4 w-4 mr-2" />
            Embed Code
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preview">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Live Preview</CardTitle>
                <CardDescription>This is how the chat widget will appear on your website</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[500px] border rounded-lg overflow-hidden">
                  <ChatWidget embedded />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Features</CardTitle>
                <CardDescription>What patients can do with the chat widget</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">1</span>
                    </div>
                    <div>
                      <p className="font-medium">Book Appointments</p>
                      <p className="text-sm text-muted-foreground">
                        Patients can book appointments with available doctors
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">2</span>
                    </div>
                    <div>
                      <p className="font-medium">Choose Services</p>
                      <p className="text-sm text-muted-foreground">
                        AI suggests doctors based on the service needed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">3</span>
                    </div>
                    <div>
                      <p className="font-medium">Ask Questions</p>
                      <p className="text-sm text-muted-foreground">
                        Get answers about clinic hours, address, and services
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">4</span>
                    </div>
                    <div>
                      <p className="font-medium">Multi-Language Support</p>
                      <p className="text-sm text-muted-foreground">
                        Chat in English or Dutch with one click
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="embed">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>JavaScript Embed</CardTitle>
                <CardDescription>
                  Add this script to your website to show the floating chat button
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg font-mono text-sm overflow-x-auto">
                  <code>{embedCode}</code>
                </div>
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(embedCode, "Script code")}
                  data-testid="button-copy-script"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Code
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>iFrame Embed</CardTitle>
                <CardDescription>
                  Embed the chat widget directly into a specific section of your page
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg font-mono text-sm overflow-x-auto whitespace-pre-wrap break-all">
                  <code>{iframeCode}</code>
                </div>
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(iframeCode, "iFrame code")}
                  data-testid="button-copy-iframe"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Code
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Standalone Chat Page</CardTitle>
              <CardDescription>
                Direct link to the chat widget that can be shared with patients
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <div className="p-4 bg-muted rounded-lg font-mono text-sm flex-1">
                <code>{window.location.origin}/chat</code>
              </div>
              <Button
                variant="outline"
                onClick={() => copyToClipboard(`${window.location.origin}/chat`, "Chat URL")}
                data-testid="button-copy-url"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy URL
              </Button>
              <Button asChild data-testid="button-open-chat-page">
                <a href="/chat" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
