/**
 * 核心消息参数支持的原始值
 */
export type DomainMessageValue = string | number | boolean;

export type DomainMessageParams = Readonly<Record<string, DomainMessageValue>>;

/**
 * 核心向外层传递的无语言消息
 */
export interface DomainMessage<Code extends string = string> {
    code: Code;
    params?: DomainMessageParams;
}
