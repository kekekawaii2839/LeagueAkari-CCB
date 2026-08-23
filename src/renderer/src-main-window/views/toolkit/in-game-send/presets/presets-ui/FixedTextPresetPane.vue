<template>
  <div class="fixed-text-preset-pane h-140">
    <div v-if="items.length === 0" class="flex h-full items-center justify-center">
      <NEmpty :description="t('empty.description')">
        <template #icon>
          <NIcon><DocumentTextIcon /></NIcon>
        </template>
        <template #extra>
          <NButton type="primary" :loading="isCreating" @click="handleCreate">
            <template #icon>
              <NIcon><AddIcon /></NIcon>
            </template>
            {{ t('empty.action') }}
          </NButton>
        </template>
      </NEmpty>
    </div>

    <div
      v-else
      class="fixed-text-layout grid h-full grid-cols-[208px_minmax(0,1fr)] gap-4 max-[760px]:grid-cols-1"
    >
      <aside
        class="fixed-text-sidebar flex min-h-0 min-w-0 flex-col overflow-hidden max-[760px]:max-h-55"
      >
        <div class="box-border flex h-7 items-center justify-between gap-2 pl-2">
          <div
            class="flex min-w-0 items-baseline gap-1.5 text-xs leading-7 font-medium text-black/78 dark:text-white/84"
          >
            {{ t('listTitle') }}
          </div>
          <NTooltip :disabled="canCreate">
            <template #trigger>
              <span class="inline-flex">
                <NButton
                  size="tiny"
                  :disabled="!canCreate"
                  :loading="isCreating"
                  @click="handleCreate"
                >
                  <template #icon>
                    <NIcon><AddIcon /></NIcon>
                  </template>
                </NButton>
              </span>
            </template>
            {{ t('addLimitReached', { count: maxItems }) }}
          </NTooltip>
        </div>

        <DragDropProvider :modifiers="dragModifiers" @drag-end="handleDragEnd">
          <div
            class="fixed-text-list flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto pt-1.5 pb-0.5"
          >
            <SortablePresetListItem
              v-for="(item, index) of items"
              :id="item.id"
              :key="item.id"
              class="fixed-text-list-item"
              :index="index"
              group="in-game-send-fixed-text"
              type="in-game-send-fixed-text-item"
              :title="item.title"
              :unnamed-label="t('unnamed')"
              :drag-label="t('dragHandle', { title: getDisplayTitle(item.title) })"
              :delete-label="t('delete')"
              :delete-confirm="t('deleteConfirm')"
              :active="item.id === selectedId"
              :dirty="item.id === selectedId && isDirty"
              :dirty-label="t('unsaved')"
              @select="handleSelect(item.id)"
              @delete="handleDelete(item.id)"
            />
          </div>
        </DragDropProvider>
      </aside>

      <section v-if="selectedItem" class="flex min-h-0 min-w-0 flex-col gap-1.5 p-0">
        <div class="grid h-7 flex-none grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div v-if="isEditingTitle" class="flex min-w-0 items-center gap-1.5">
            <span
              class="size-1.5 flex-none rounded-full transition-opacity"
              :class="isDirty ? 'bg-orange-500 opacity-100 dark:bg-orange-400' : 'opacity-0'"
              :title="isDirty ? t('unsaved') : undefined"
            >
              <span v-if="isDirty" class="sr-only">{{ t('unsaved') }}</span>
            </span>
            <NInput
              ref="titleInputRef"
              :value="draftTitle"
              class="min-w-0 flex-1"
              size="small"
              :maxlength="titleMaxLength"
              clearable
              @update:value="handleTitleUpdate"
              @blur="finishTitleEdit"
              @keydown.enter="handleTitleInputEnter"
            />
          </div>
          <button
            v-else
            type="button"
            class="editor-title-display flex h-7 min-w-0 cursor-text items-center gap-1.5 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600/50"
            @click="startTitleEdit"
          >
            <span
              class="size-1.5 flex-none rounded-full transition-opacity"
              :class="isDirty ? 'bg-orange-500 opacity-100 dark:bg-orange-400' : 'opacity-0'"
              :title="isDirty ? t('unsaved') : undefined"
            >
              <span v-if="isDirty" class="sr-only">{{ t('unsaved') }}</span>
            </span>
            <span
              class="min-w-0 overflow-hidden text-[15px] leading-7 text-ellipsis whitespace-nowrap"
              :class="
                getTrimmedTitle(draftTitle)
                  ? 'font-[650] text-black/82 dark:text-white/86'
                  : 'font-medium text-black/38 dark:text-white/38'
              "
            >
              {{ getDisplayTitle(draftTitle) }}
            </span>
          </button>

          <div class="flex items-center gap-0.5">
            <NTooltip v-if="!isEditingTitle">
              <template #trigger>
                <NButton
                  size="tiny"
                  quaternary
                  :aria-label="t('editTitle')"
                  @click="startTitleEdit"
                >
                  <template #icon>
                    <NIcon><EditIcon /></NIcon>
                  </template>
                </NButton>
              </template>
              {{ t('editTitle') }}
            </NTooltip>

            <NTooltip>
              <template #trigger>
                <NButton
                  size="tiny"
                  quaternary
                  :disabled="!currentModel"
                  :aria-label="t('expand')"
                  @click="isExpanded = true"
                >
                  <template #icon>
                    <NIcon><ExpandIcon /></NIcon>
                  </template>
                </NButton>
              </template>
              {{ t('expand') }}
            </NTooltip>
          </div>
        </div>

        <SettingsRow
          :label="t('shortcutLabel')"
          :label-description="t('shortcutDescription')"
          :label-width="96"
          :gap="16"
          class="flex-none"
          no-x-padding
        >
          <ShortcutSelector
            :shortcut-id="selectedItem.shortcut"
            :target-id="fixedTextPreset.getShortcutTargetId(selectedItem.id)"
            @update:shortcut-id="handleShortcutUpdate"
          />
        </SettingsRow>

        <div
          class="min-h-0 flex-1 overflow-hidden rounded-[5px] border border-black/10 dark:border-white/10"
        >
          <div v-if="isLoadingMonaco" class="flex h-full items-center justify-center">
            <NSpin size="small" />
          </div>
          <NAlert v-else-if="monacoLoadError" type="error" class="m-3">
            {{ t('editorLoadFailed', { reason: monacoLoadError }) }}
          </NAlert>
          <MonacoEditor
            v-else-if="currentModel && !isExpanded"
            :model="currentModel"
            :theme="monacoTheme"
            variant="plain-text"
          />
        </div>

        <div class="flex flex-none flex-wrap items-center justify-between gap-2.5">
          <span
            class="text-xs [font-variant-numeric:tabular-nums]"
            :class="
              draftContent.length >= contentMaxLength
                ? 'text-orange-700/85 dark:text-orange-400/90'
                : 'text-black/45 dark:text-white/45'
            "
          >
            {{ draftContent.length }} / {{ contentMaxLength }}
          </span>

          <div class="flex items-center gap-1.5">
            <NButton size="small" :disabled="!isDirty" @click="handleRevert">
              <template #icon>
                <NIcon><UndoIcon /></NIcon>
              </template>
              {{ t('revert') }}
            </NButton>

            <NTooltip :disabled="!sendDisabledReason">
              <template #trigger>
                <span class="inline-flex">
                  <NButton
                    size="small"
                    type="primary"
                    :disabled="!!sendDisabledReason"
                    @click="handleSend"
                  >
                    <template #icon>
                      <NIcon><SendIcon /></NIcon>
                    </template>
                    {{ sendButtonText }}
                  </NButton>
                </span>
              </template>
              {{ sendDisabledReason }}
            </NTooltip>

            <NButton
              size="small"
              type="primary"
              secondary
              :loading="isSaving"
              :disabled="!isDirty"
              @click="handleSaveClick"
            >
              <template #icon>
                <NIcon><SaveIcon /></NIcon>
              </template>
              {{ t('save') }}
            </NButton>
          </div>
        </div>
      </section>
    </div>

    <NModal
      v-if="currentModel"
      v-model:show="isExpanded"
      preset="card"
      :title="t('expandedTitle', { title: getDisplayTitle(draftTitle) })"
      :bordered="false"
      style="width: calc(100vw - 48px); max-width: none"
    >
      <div class="flex h-[calc(100vh-132px)] min-h-0 flex-col gap-3">
        <div class="flex flex-wrap items-center justify-end gap-2">
          <span class="text-xs text-black/45 tabular-nums dark:text-white/45">
            {{ draftContent.length }} / {{ contentMaxLength }}
          </span>
          <NButton size="small" secondary :disabled="!isDirty" @click="handleRevert">
            {{ t('revert') }}
          </NButton>
          <NButton
            size="small"
            type="primary"
            :loading="isSaving"
            :disabled="!isDirty"
            @click="handleSaveClick"
          >
            {{ t('save') }}
          </NButton>
        </div>
        <div
          class="min-h-0 flex-1 overflow-hidden rounded-[5px] border border-black/10 dark:border-white/10"
        >
          <MonacoEditor
            :model="currentModel"
            :theme="monacoTheme"
            variant="plain-text"
            :use-shadow-dom="false"
          />
        </div>
      </div>
    </NModal>
  </div>
</template>

<script setup lang="ts">
import ShortcutSelector from '@main-window/components/ShortcutSelector.vue'
import SettingsRow from '@renderer-shared/components/SettingsRow.vue'
import { useComponentName } from '@renderer-shared/composables/useComponentName'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import {
  IN_GAME_SEND_FIXED_TEXT_PRESET_CONTENT_MAX_LENGTH,
  IN_GAME_SEND_FIXED_TEXT_PRESET_MAX_ITEMS,
  IN_GAME_SEND_FIXED_TEXT_PRESET_TITLE_MAX_LENGTH,
  type InGameSendFixedTextPresetItem
} from '@shared/shards/in-game-send'
import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers'
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/vue'
import { isSortable } from '@dnd-kit/vue/sortable'
import {
  Add24Regular as AddIcon,
  ArrowExpand24Regular as ExpandIcon,
  DocumentText24Regular as DocumentTextIcon,
  Edit24Regular as EditIcon,
  Save24Regular as SaveIcon,
  Send24Filled as SendIcon,
  ArrowUndo24Regular as UndoIcon
} from '@vicons/fluent'
import { useTranslation } from 'i18next-vue'
import type { IDisposable, editor } from 'monaco-editor/editor/editor.api.js'
import {
  NAlert,
  NButton,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NSpin,
  NTooltip,
  useMessage
} from 'naive-ui'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { useNativeInputStatus } from '../composables/useNativeInputStatus'
import { useFixedTextPreset } from '../data/fixed-text'
import { loadMonaco, MonacoEditor, type MonacoApi } from '../monaco'
import SortablePresetListItem from '../widgets/SortablePresetListItem.vue'

const fixedTextPreset = useFixedTextPreset()
const appCommonStore = useAppCommonStore()
const componentName = useComponentName()
const logger = useInstance(LoggerRenderer)
const message = useMessage()
const { t } = useTranslation('renderer', { keyPrefix: 'toolkit.inGameSend.presets.fixedText' })
const { unavailableReason: nativeInputUnavailableMessage } = useNativeInputStatus()

const maxItems = IN_GAME_SEND_FIXED_TEXT_PRESET_MAX_ITEMS
const titleMaxLength = IN_GAME_SEND_FIXED_TEXT_PRESET_TITLE_MAX_LENGTH
const contentMaxLength = IN_GAME_SEND_FIXED_TEXT_PRESET_CONTENT_MAX_LENGTH
const dragModifiers = [RestrictToVerticalAxis]

const titleInputRef = ref<InstanceType<typeof NInput> | null>(null)
const selectedId = ref<string | null>(null)
const draftTitle = ref('')
const draftContent = ref('')
const isDirty = ref(false)
const isSaving = ref(false)
const isCreating = ref(false)
const isEditingTitle = ref(false)
const isExpanded = ref(false)
const pendingTitleEditItemId = ref<string | null>(null)
const models = new Map<string, editor.ITextModel>()
const modelSubscriptions = new Map<string, IDisposable>()
const currentModel = shallowRef<editor.ITextModel | null>(null)
const monacoApi = shallowRef<MonacoApi | null>(null)
const monacoLoadError = ref<string | null>(null)
const isLoadingMonaco = ref(false)

const items = computed(() => fixedTextPreset.items.value)
const selectedItem = computed(
  () => items.value.find((item) => item.id === selectedId.value) ?? null
)
const canCreate = computed(() => items.value.length < maxItems)
const monacoTheme = computed<'vs' | 'vs-dark'>(() =>
  appCommonStore.colorTheme === 'dark' ? 'vs-dark' : 'vs'
)

const sendButtonText = computed(() => {
  if (fixedTextPreset.gamePhase.value === 'in-game') {
    return t('sendToGame')
  }

  if (
    fixedTextPreset.gamePhase.value === 'lobby' ||
    fixedTextPreset.gamePhase.value === 'champ-select'
  ) {
    return t('sendToChat')
  }

  return t('send')
})

const sendDisabledReason = computed(() => {
  if (!selectedItem.value) {
    return t('disabled.noSelection')
  }

  if (isDirty.value) {
    return t('disabled.saveFirst')
  }

  if (fixedTextPreset.gamePhase.value === 'draft') {
    return t('disabled.draftOnly')
  }

  if (fixedTextPreset.gamePhase.value === 'in-game' && nativeInputUnavailableMessage.value) {
    return nativeInputUnavailableMessage.value
  }

  if (!fixedTextPreset.canSend.value) {
    return t('disabled.unavailable')
  }

  return null
})

watch(
  items,
  (currentItems) => {
    const currentIds = new Set(currentItems.map((item) => item.id))

    for (const id of models.keys()) {
      if (!currentIds.has(id)) {
        disposeModel(id)
      }
    }

    if (currentItems.length === 0) {
      selectedId.value = null
      return
    }

    if (!selectedId.value || !currentItems.some((item) => item.id === selectedId.value)) {
      selectedId.value = currentItems[0].id
    }
  },
  { immediate: true }
)

watch(
  () => selectedItem.value?.id,
  async (id) => {
    const item = selectedItem.value
    currentModel.value = null
    isExpanded.value = false
    isDirty.value = false
    draftTitle.value = item?.title ?? ''
    draftContent.value = item?.content ?? ''

    if (id && pendingTitleEditItemId.value === id) {
      pendingTitleEditItemId.value = null
      isEditingTitle.value = true
      await nextTick()
      titleInputRef.value?.focus()
    } else {
      isEditingTitle.value = false
    }

    if (!id || !item) {
      return
    }

    const model = await ensureModel(item)
    if (selectedId.value === id) {
      currentModel.value = model
    }
  },
  { immediate: true }
)

async function ensureMonaco() {
  if (monacoApi.value) {
    return monacoApi.value
  }

  isLoadingMonaco.value = true
  monacoLoadError.value = null
  try {
    monacoApi.value = await loadMonaco()
    return monacoApi.value
  } catch (error) {
    monacoLoadError.value = error instanceof Error ? error.message : String(error)
    logger.warn(componentName, 'Failed to load Monaco editor', error)
    return null
  } finally {
    isLoadingMonaco.value = false
  }
}

async function ensureModel(item: InGameSendFixedTextPresetItem) {
  const existingModel = models.get(item.id)
  if (existingModel) {
    return existingModel
  }

  const monaco = await ensureMonaco()
  if (!monaco) {
    return null
  }

  const model = monaco.editor.createModel(
    item.content,
    'plaintext',
    monaco.Uri.parse(`inmemory://league-akari/in-game-send-fixed-text/${item.id}.txt`)
  )
  const subscription = model.onDidChangeContent(() => {
    if (selectedId.value !== item.id) {
      return
    }

    const value = model.getValue()
    if (value.length > contentMaxLength) {
      model.setValue(value.slice(0, contentMaxLength))
      return
    }

    draftContent.value = value
    isDirty.value = true
  })

  models.set(item.id, model)
  modelSubscriptions.set(item.id, subscription)
  return model
}

function disposeModel(id: string) {
  modelSubscriptions.get(id)?.dispose()
  modelSubscriptions.delete(id)
  models.get(id)?.dispose()
  models.delete(id)
}

const getTrimmedTitle = (title: string) => {
  return title.trim()
}

const getDisplayTitle = (title: string) => {
  return getTrimmedTitle(title) || t('unnamed')
}

const handleTitleUpdate = (value: string) => {
  draftTitle.value = value.slice(0, titleMaxLength)
  isDirty.value = true
}

const saveCurrent = async () => {
  if (!selectedItem.value || !isDirty.value) {
    return true
  }

  if (isSaving.value) {
    return false
  }

  isSaving.value = true
  try {
    await fixedTextPreset.updateItem(selectedItem.value.id, {
      title: draftTitle.value.slice(0, titleMaxLength),
      content: draftContent.value.slice(0, contentMaxLength)
    })

    isDirty.value = false
    message.success(t('saved'))

    return true
  } catch (error) {
    logger.warn(componentName, 'Failed to update fixed text preset', error)
    message.error(t('saveFailed'))
    return false
  } finally {
    isSaving.value = false
  }
}

const handleSaveClick = async () => {
  if (await saveCurrent()) {
    isEditingTitle.value = false
  }
}

const startTitleEdit = async () => {
  pendingTitleEditItemId.value = null
  isEditingTitle.value = true
  await nextTick()
  titleInputRef.value?.focus()
}

const finishTitleEdit = () => {
  isEditingTitle.value = false
}

const handleTitleInputEnter = (event: KeyboardEvent) => {
  if (event.isComposing) {
    return
  }

  event.preventDefault()
  finishTitleEdit()
}

const revertCurrentDraft = () => {
  if (!selectedItem.value) {
    return
  }

  if (isDirty.value) {
    draftTitle.value = selectedItem.value.title
    draftContent.value = selectedItem.value.content
    currentModel.value?.setValue(selectedItem.value.content)
  }
  isDirty.value = false
  isEditingTitle.value = false
}

const handleRevert = () => {
  revertCurrentDraft()
}

const handleSelect = (id: string) => {
  if (id === selectedId.value) {
    return
  }

  revertCurrentDraft()
  selectedId.value = id
}

const handleCreate = async () => {
  if (!canCreate.value) {
    return
  }

  isCreating.value = true
  try {
    const item = await fixedTextPreset.createItem()
    revertCurrentDraft()
    selectedId.value = item.id
    draftTitle.value = ''
    draftContent.value = ''
    pendingTitleEditItemId.value = item.id
    isEditingTitle.value = true
    await nextTick()
    titleInputRef.value?.focus()
  } catch (error) {
    logger.warn(componentName, 'Failed to create fixed text preset', error)
    message.error(t('createFailed'))
  } finally {
    isCreating.value = false
  }
}

const handleDelete = async (id: string) => {
  const deletedItem = items.value.find((item) => item.id === id)

  if (!deletedItem) {
    return
  }

  const currentItems = items.value
  const currentIndex = currentItems.findIndex((item) => item.id === id)
  const nextItems = currentItems.filter((item) => item.id !== id)
  const nextSelectedItem = nextItems[Math.min(currentIndex, nextItems.length - 1)] ?? null

  try {
    await fixedTextPreset.deleteItem(id)

    if (selectedId.value === id) {
      selectedId.value = nextSelectedItem?.id ?? null
      isEditingTitle.value = false
    }

    message.success(t('deleted'))
  } catch (error) {
    logger.warn(componentName, 'Failed to delete fixed text preset', error)
    message.error(t('deleteFailed'))
  }
}

const handleDragEnd = async (event: DragEndEvent) => {
  const { source } = event.operation

  if (event.canceled || !isSortable(source)) {
    return
  }

  const id = String(source.id)
  const currentIndex = items.value.findIndex((item) => item.id === id)
  const targetIndex = Math.min(Math.max(source.index, 0), items.value.length - 1)

  if (currentIndex === -1 || currentIndex === targetIndex) {
    return
  }

  try {
    await fixedTextPreset.reorderItem(id, targetIndex)
  } catch (error) {
    logger.warn(componentName, 'Failed to reorder fixed text preset', error)
  }
}

const handleShortcutUpdate = async (shortcutId: string | null) => {
  if (!selectedItem.value) {
    return
  }

  try {
    await fixedTextPreset.setShortcut(selectedItem.value.id, shortcutId)
    message.success(t('saved'))
  } catch (error) {
    logger.warn(componentName, 'Failed to update fixed text preset shortcut', error)
    message.error(t('saveFailed'))
  }
}

const handleSend = async () => {
  if (!selectedItem.value || sendDisabledReason.value) {
    return
  }

  const sent = await fixedTextPreset.send(selectedItem.value.id)

  if (sent) {
    const title = getTrimmedTitle(selectedItem.value.title)
    message.success(title ? t('sendSucceededWithTitle', { title }) : t('sendSucceeded'))
  }
}

onBeforeUnmount(() => {
  for (const id of models.keys()) {
    disposeModel(id)
  }
})
</script>
