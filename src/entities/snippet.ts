
export interface Snippet {
    prefix: string;
    body: string | string[];
    description: string;
    scope: string;
    context: string;
}

export interface Snippets {
    [key: string]: Snippet;
}